import { GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { demoCycle } from '../demo/demoCycle'
import { emulatorMode, firebaseConfigured, nativAuth } from '../infrastructure/firebase/client'
import { CoordinatorWorkflowWorkspace } from './CoordinatorWorkflowWorkspace'
import { claimInitialAccessManager, getMyNativAccess, seedDemoEnvironment, type DemoAccount, type NativSessionAccess } from './firebaseApi'
import { StudentPreferenceWorkspace } from './StudentPreferenceWorkspace'
import { AccessManagerWorkspace } from './AccessManagerWorkspace'
import { AppealReviewerWorkspace } from './AppealReviewerWorkspace'
import { SecretaryWorkspace } from './SecretaryWorkspace'

interface SessionProfile { user: User; access: NativSessionAccess }

export function NativMvp() {
  const [accounts, setAccounts] = useState<DemoAccount[]>([])
  const [session, setSession] = useState<SessionProfile | null>(null)
  const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(null)
  const [message, setMessage] = useState(firebaseConfigured ? (emulatorMode ? 'מכין את סביבת ההדגמה…' : 'ממתין לכניסה מאובטחת…') : 'Firebase אינו מוגדר לסביבה זו.')

  useEffect(() => {
    if (!nativAuth) return
    const unsubscribe = onAuthStateChanged(nativAuth, (user) => {
      setAuthenticatedUser(user)
      if (!user) { setSession(null); return }
      void getMyNativAccess().then((access) => {
        setSession({ user, access }); setMessage(`מחובר${access.displayName ? ` כ${access.displayName}` : ''}`)
      }).catch((error: unknown) => { setSession(null); setMessage(error instanceof Error ? error.message : 'טעינת ההרשאות נכשלה.') })
    })
    if (emulatorMode) void seedDemoEnvironment()
      .then((result) => { setAccounts(result.accounts); setMessage('סביבת ההדגמה מוכנה.') })
      .catch(() => setMessage('יש להפעיל תחילה pnpm emulators בחלון מסוף נפרד.'))
    return unsubscribe
  }, [])

  async function login(account: DemoAccount) {
    if (!nativAuth) return
    try {
      setMessage(`נכנס כ${account.label}…`)
      await signInWithEmailAndPassword(nativAuth, account.email, account.password)
      setMessage(`מחובר כ${account.label}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'הכניסה נכשלה') }
  }

  async function loginWithGoogle() {
    if (!nativAuth) return
    try { setMessage('פותח כניסה באמצעות Google…'); await signInWithPopup(nativAuth, new GoogleAuthProvider()) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'הכניסה נכשלה') }
  }

  async function activateInitialManager() {
    try { await claimInitialAccessManager(); const access = await getMyNativAccess(); if (session) setSession({ ...session, access }); setMessage('ניהול הגישה הופעל לחשבון זה.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'הפעלת מנהל הגישה נכשלה') }
  }

  async function logout() {
    if (nativAuth) await signOut(nativAuth)
    setMessage('יצאת מהמערכת.')
  }

  return (
    <section className="mvp-shell" aria-labelledby="mvp-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">{emulatorMode ? 'סביבת בדיקה פעילה' : 'כניסה מאובטחת'}</span><h2 id="mvp-title">כניסה לנתיב</h2></div>
        {authenticatedUser && <button type="button" className="text-action" onClick={() => void logout()}>יציאה</button>}
      </div>
      <p className="workspace-message" aria-live="polite">{message}</p>
      {!authenticatedUser && !emulatorMode && <button type="button" className="primary-action" onClick={() => void loginWithGoogle()}>כניסה עם Google</button>}
      {!authenticatedUser && emulatorMode && (
        <div className="demo-login-grid">
          {accounts.map((account) => <button type="button" key={account.email} onClick={() => void login(account)}><span>{account.label.slice(0, 1)}</span><strong>כניסה כ{account.label}</strong><small>{account.email}</small></button>)}
        </div>
      )}
      {session && !session.access.roles.length && <div className="workspace-card"><h3>החשבון מאומת אך טרם הוקצה לו תפקיד בנתיב</h3>{session.access.coreRole === 'school_admin' && <button type="button" className="primary-action" onClick={() => void activateInitialManager()}>הפעלת מנהל הגישה הראשון</button>}</div>}
      {session?.access.roles.includes('student') && <StudentPreferenceWorkspace cycleId={demoCycle.id} />}
      {session?.access.roles.includes('placement_coordinator') && <CoordinatorWorkflowWorkspace cycleId={demoCycle.id} />}
      {session?.access.roles.includes('appeal_reviewer') && !session.access.roles.includes('placement_coordinator') && <AppealReviewerWorkspace cycleId={demoCycle.id} />}
      {session?.access.roles.includes('access_manager') && <AccessManagerWorkspace />}
      {session?.access.roles.includes('secretary') && <SecretaryWorkspace cycleId={demoCycle.id} />}
    </section>
  )
}
