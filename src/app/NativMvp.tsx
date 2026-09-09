import { ReadOnlyContext } from './readOnly'
import { useConfirmAction } from './interaction'
import { GoogleAuthProvider, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RoleId } from '../domain/access'
import type { AssignmentCycle } from '../domain/cycle'
import { emulatorMode, firebaseConfigured, nativAuth } from '../infrastructure/firebase/client'
import { AccessManagerWorkspace } from './AccessManagerWorkspace'
import { AppealReviewerWorkspace } from './AppealReviewerWorkspace'
import { CoordinatorWorkflowWorkspace } from './CoordinatorWorkflowWorkspace'
import { CycleSetupWorkspace } from './CycleSetupWorkspace'
import { InstructorWorkspace } from './InstructorWorkspace'
import { claimInitialAccessManager, exchangeGoogleIdentity, getMyNativAccess, listCycles, listGoogleAccessOptions, seedDemoEnvironment, type DemoAccount, type GoogleAccessOption, type NativSessionAccess } from './firebaseApi'
import { SecretaryWorkspace } from './SecretaryWorkspace'
import { StudentPreferenceWorkspace } from './StudentPreferenceWorkspace'

interface SessionProfile { user: User; access: NativSessionAccess }
const areaLabels: Partial<Record<RoleId, string>> = { student: 'הבחירות שלי', placement_coordinator: 'ניהול השיבוץ', appeal_reviewer: 'בדיקת ערעורים', access_manager: 'ניהול גישה', secretary: 'דיווחים למזכירות', course_instructor: 'הקורסים שלי' }
const areaOrder: RoleId[] = ['student', 'placement_coordinator', 'appeal_reviewer', 'secretary', 'course_instructor', 'access_manager']

function friendlyError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  return error.message.replace(/\s*\[\d+\]\s*$/, '').replace(/^Firebase:\s*/u, '')
}

function needsGoogleIdentityExchange(error: unknown) {
  return error instanceof Error && error.message.includes('לא נמצא שיוך ארגוני פעיל')
}

export function NativMvp() {
  const { confirm, confirmation } = useConfirmAction()
  async function navigate(action: () => void | Promise<void>) {
    const event = new Event('nativ-before-navigation', { cancelable: true })
    if (!window.dispatchEvent(event) && !(await confirm('יש שינויים שטרם נשמרו. לצאת מהמסך ולהשאיר אותם ללא שמירה?'))) return
    await action()
  }
  const [accounts, setAccounts] = useState<DemoAccount[]>([])
  const [session, setSession] = useState<SessionProfile | null>(null)
  const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(null)
  const [organizationOptions, setOrganizationOptions] = useState<GoogleAccessOption[]>([])
  const [selectedArea, setSelectedArea] = useState<RoleId | null>(null)
  const [cycles, setCycles] = useState<AssignmentCycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)
  const [creatingCycle, setCreatingCycle] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState(firebaseConfigured ? 'אפשר להיכנס ולהמשיך.' : 'המערכת אינה זמינה כרגע.')
  const authRequest = useRef(0)

  useEffect(() => {
    if (!nativAuth) return
    const auth = nativAuth
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const requestId = ++authRequest.current
      setAuthenticatedUser(user)
      setOrganizationOptions([])
      setSession(null)
      setSelectedArea(null)
      setCycles([])
      setSelectedCycleId(null)
      setCreatingCycle(false)
      if (!user) return
      setMessage('טוען את סביבת העבודה שלך…')
      void (async () => {
        try {
          return await getMyNativAccess()
        } catch (accessError) {
          if (emulatorMode || !needsGoogleIdentityExchange(accessError) || !user.providerData.some((provider) => provider.providerId === 'google.com')) throw accessError
          const options = await listGoogleAccessOptions()
          if (!options.length) throw new Error('חשבון Google זה אינו משויך לבית ספר פעיל ב־EdTrack.')
          if (options.length > 1) {
            if (authRequest.current === requestId) {
              setOrganizationOptions(options)
              setMessage('בחרו את בית הספר שאליו תרצו להיכנס.')
            }
            return null
          }
          const customToken = await exchangeGoogleIdentity(options[0].id)
          if (authRequest.current === requestId) await signInWithCustomToken(auth, customToken)
          return null
        }
      })().then((access) => {
        if (!access) return
        if (authRequest.current !== requestId || auth.currentUser?.uid !== user.uid) return
        setSession({ user, access })
        setSelectedArea(areaOrder.find((role) => access.roles.includes(role)) ?? null)
        setMessage(access.displayName ? `שלום ${access.displayName}` : 'הכניסה הושלמה.')
        void listCycles().then((loaded) => { if (authRequest.current === requestId) { setCycles(loaded); setSelectedCycleId(loaded[0]?.id ?? null) } }).catch(() => setMessage('לא ניתן לטעון את מחזורי השיבוץ.'))
      }).catch((error: unknown) => { if (authRequest.current === requestId) setMessage(friendlyError(error, 'לא ניתן לטעון את ההרשאות.')) })
    })
    if (emulatorMode) void seedDemoEnvironment().then((result) => setAccounts(result.accounts)).catch(() => setMessage('סביבת הבדיקה אינה זמינה.'))
    return unsubscribe
  }, [])

  const availableAreas = useMemo(() => areaOrder.filter((role) => session?.access.roles.includes(role)), [session])
  async function refreshCycles() { const loaded = await listCycles(); setCycles(loaded); setSelectedCycleId((current) => current && loaded.some((cycle) => cycle.id === current) ? current : loaded[0]?.id ?? null); setCreatingCycle(false) }

  async function login(account: DemoAccount) {
    if (!nativAuth || pending) return
    try { setPending(true); setMessage('נכנס למערכת…'); await signInWithEmailAndPassword(nativAuth, account.email, account.password) }
    catch (error) { setMessage(friendlyError(error, 'הכניסה נכשלה.')) }
    finally { setPending(false) }
  }
  async function loginWithGoogle() {
    if (!nativAuth || pending) return
    try { setPending(true); await signInWithPopup(nativAuth, new GoogleAuthProvider()) }
    catch (error) { setMessage(friendlyError(error, 'הכניסה נכשלה.')) }
    finally { setPending(false) }
  }
  async function enterOrganization(option: GoogleAccessOption) {
    if (!nativAuth || pending) return
    try {
      setPending(true)
      setMessage(`נכנס לבית הספר ${option.name}…`)
      const customToken = await exchangeGoogleIdentity(option.id)
      await signInWithCustomToken(nativAuth, customToken)
    } catch (error) { setMessage(friendlyError(error, 'לא ניתן להיכנס לבית הספר שנבחר.')) }
    finally { setPending(false) }
  }
  async function activateInitialManager() {
    if (pending) return
    try { setPending(true); await claimInitialAccessManager(); const access = await getMyNativAccess(); if (session) setSession({ ...session, access }); setSelectedArea('access_manager'); setMessage('ניהול הגישה הופעל לחשבון זה.') }
    catch (error) { setMessage(friendlyError(error, 'הפעלת מנהל הגישה נכשלה.')) }
    finally { setPending(false) }
  }
  async function logout() { if (nativAuth) await signOut(nativAuth); setMessage('יצאת מהמערכת.') }

  return <section className="mvp-shell" aria-labelledby="mvp-title">
    <div className="workspace-heading"><div><span className="eyebrow">החשבון שלך</span><h2 id="mvp-title">{authenticatedUser ? 'סביבת העבודה' : 'כניסה לנתיב'}</h2></div>{authenticatedUser && <button type="button" className="text-action" onClick={() => void navigate(logout)}>יציאה</button>}</div>
    {confirmation}
    {creatingCycle && <button className="text-action" onClick={() => void navigate(() => { setCreatingCycle(false); setSelectedCycleId(cycles[0]?.id ?? null) })}>חזרה למחזור הקיים</button>}
    <p className="workspace-message" aria-live="polite">{message}</p>
    {!authenticatedUser && !emulatorMode && <button type="button" className="primary-action" disabled={pending} onClick={() => void loginWithGoogle()}>כניסה עם Google</button>}
    {authenticatedUser && !session && organizationOptions.length > 1 && <div className="workspace-card"><h3>בחירת בית ספר</h3><div className="organization-options">{organizationOptions.map((option) => <button type="button" className="secondary-action" disabled={pending} key={option.id} onClick={() => void enterOrganization(option)}>{option.name}</button>)}</div></div>}
    {!authenticatedUser && emulatorMode && <div className="demo-login-grid">{accounts.map((account) => <button type="button" disabled={pending} key={account.email} onClick={() => void login(account)}><span>{account.label.slice(0, 1)}</span><strong>כניסה כ{account.label}</strong></button>)}</div>}
    {session && !session.access.roles.length && <div className="workspace-card"><h3>עדיין לא הוקצה לך תפקיד בנתיב</h3><p>מנהל הגישה בבית הספר יכול להקצות לך תפקיד מתאים.</p>{session.access.coreRole === 'school_admin' && <button type="button" className="primary-action" disabled={pending} onClick={() => void activateInitialManager()}>הפעלת מנהל הגישה הראשון</button>}</div>}
    {session?.access.accessMode === 'read_only' && <p className="read-only-notice">המידע זמין לצפייה בלבד. לא ניתן לבצע שינויים כעת.</p>}
    {availableAreas.length > 1 && <nav className="role-navigation" aria-label="בחירת סביבת עבודה">{availableAreas.map((role) => <button type="button" className={selectedArea === role ? 'active' : ''} aria-current={selectedArea === role ? 'page' : undefined} key={role} onClick={() => void navigate(() => setSelectedArea(role))}>{areaLabels[role]}</button>)}</nav>}
    {session && selectedArea && selectedArea !== 'access_manager' && cycles.length > 0 && <label className="cycle-picker">מחזור<select value={selectedCycleId ?? ''} onChange={(event) => { const id = event.target.value; void navigate(() => setSelectedCycleId(id)) }}>{cycles.map((cycle) => <option value={cycle.id} key={cycle.id}>{cycle.schoolYear} · {cycle.termLabel}</option>)}</select></label>}
    {session && selectedArea === 'placement_coordinator' && selectedCycleId && !creatingCycle && session.access.accessMode !== 'read_only' && <button type="button" className="secondary-action" onClick={() => void navigate(() => { setCreatingCycle(true); setSelectedCycleId(null) })}>הקמת מחזור חדש</button>}
    {session && selectedArea && !selectedCycleId && !['access_manager', 'placement_coordinator'].includes(selectedArea) && <section className="workspace-card"><h2>אין מחזור שיבוץ זמין</h2><p>כאשר ייפתח מחזור מתאים הוא יופיע כאן.</p></section>}
    {session && selectedArea && (selectedCycleId || ['access_manager', 'course_instructor', 'placement_coordinator'].includes(selectedArea)) && <ReadOnlyContext.Provider value={session.access.accessMode === 'read_only'}><fieldset key={`${session.user.uid}-${selectedArea}-${selectedCycleId ?? "new"}`} className="workspace-boundary">
      {selectedArea === 'placement_coordinator' && !selectedCycleId && <fieldset className="workspace-boundary" disabled={session.access.accessMode === 'read_only'}><CycleSetupWorkspace onChanged={refreshCycles} /></fieldset>}
      {selectedArea === 'placement_coordinator' && cycles.find((cycle) => cycle.id === selectedCycleId)?.status === 'draft' && <fieldset className="workspace-boundary" disabled={session.access.accessMode === 'read_only'}><CycleSetupWorkspace cycle={cycles.find((cycle) => cycle.id === selectedCycleId)} onChanged={refreshCycles} /></fieldset>}
      {selectedArea === 'student' && selectedCycleId && <fieldset className="workspace-boundary" disabled={session.access.accessMode === 'read_only'}><StudentPreferenceWorkspace cycleId={selectedCycleId} readOnly={session.access.accessMode === 'read_only'} /></fieldset>}
      {selectedArea === 'placement_coordinator' && selectedCycleId && <CoordinatorWorkflowWorkspace cycleId={selectedCycleId} onCycleChanged={refreshCycles} />}
      {selectedArea === 'appeal_reviewer' && selectedCycleId && <AppealReviewerWorkspace cycleId={selectedCycleId} />}
      {selectedArea === 'access_manager' && <AccessManagerWorkspace />}
      {selectedArea === 'secretary' && selectedCycleId && <SecretaryWorkspace cycleId={selectedCycleId} />}
      {selectedArea === 'course_instructor' && selectedCycleId && <InstructorWorkspace cycleId={selectedCycleId} />}
    </fieldset></ReadOnlyContext.Provider>}
  </section>
}
