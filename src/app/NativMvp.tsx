import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { demoCycle } from '../demo/demoCycle'
import { firebaseConfigured, nativAuth } from '../infrastructure/firebase/client'
import { CoordinatorWorkflowWorkspace } from './CoordinatorWorkflowWorkspace'
import { seedDemoEnvironment, type DemoAccount } from './firebaseApi'
import { StudentPreferenceWorkspace } from './StudentPreferenceWorkspace'
import { AccessManagerWorkspace } from './AccessManagerWorkspace'
import { AppealReviewerWorkspace } from './AppealReviewerWorkspace'
import { SecretaryWorkspace } from './SecretaryWorkspace'

interface SessionProfile { user: User; roles: string[] }

export function NativMvp() {
  const [accounts, setAccounts] = useState<DemoAccount[]>([])
  const [session, setSession] = useState<SessionProfile | null>(null)
  const [message, setMessage] = useState(firebaseConfigured ? 'מכין את סביבת ההדגמה…' : 'Firebase אינו מוגדר לסביבה זו.')

  useEffect(() => {
    if (!nativAuth) return
    const unsubscribe = onAuthStateChanged(nativAuth, (user) => {
      if (!user) { setSession(null); return }
      void user.getIdTokenResult(true).then((token) => {
        setSession({ user, roles: Array.isArray(token.claims.roles) ? token.claims.roles.filter((role): role is string => typeof role === 'string') : [] })
      }).catch(() => setMessage('טעינת ההרשאות נכשלה.'))
    })
    void seedDemoEnvironment()
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

  async function logout() {
    if (nativAuth) await signOut(nativAuth)
    setMessage('יצאת מסביבת ההדגמה.')
  }

  return (
    <section className="mvp-shell" aria-labelledby="mvp-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">מערכת מקומית פעילה</span><h2 id="mvp-title">כניסה לנתיב</h2></div>
        {session && <button type="button" className="text-action" onClick={() => void logout()}>יציאה</button>}
      </div>
      <p className="workspace-message" aria-live="polite">{message}</p>
      {!session && (
        <div className="demo-login-grid">
          {accounts.map((account) => <button type="button" key={account.email} onClick={() => void login(account)}><span>{account.label.slice(0, 1)}</span><strong>כניסה כ{account.label}</strong><small>{account.email}</small></button>)}
        </div>
      )}
      {session?.roles.includes('student') && <StudentPreferenceWorkspace cycleId={demoCycle.id} />}
      {session?.roles.includes('placement_coordinator') && <CoordinatorWorkflowWorkspace cycleId={demoCycle.id} />}
      {session?.roles.includes('appeal_reviewer') && !session.roles.includes('placement_coordinator') && <AppealReviewerWorkspace cycleId={demoCycle.id} />}
      {session?.roles.includes('access_manager') && <AccessManagerWorkspace />}
      {session?.roles.includes('secretary') && <SecretaryWorkspace cycleId={demoCycle.id} />}
    </section>
  )
}
