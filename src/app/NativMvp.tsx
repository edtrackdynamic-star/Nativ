import { SchoolBrand } from '../components/SchoolBrand'
import { isCurrentYearWindow, preferredCycleId, schoolYearLabel } from '../domain/schoolYear'
import { resolveSession, withSessionTimeout } from './sessionResolution'
import { getDownloadURL, ref } from 'firebase/storage'
import { ReadOnlyContext } from './readOnly'
import { useConfirmAction } from './interaction'
import { GoogleAuthProvider, onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RoleId } from '../domain/access'
import type { AssignmentCycle } from '../domain/cycle'
import { emulatorMode, firebaseConfigured, nativAuth, nativStorage } from '../infrastructure/firebase/client'
import { AccessManagerWorkspace } from './AccessManagerWorkspace'
import { AppealReviewerWorkspace } from './AppealReviewerWorkspace'
import { CoordinatorWorkflowWorkspace } from './CoordinatorWorkflowWorkspace'
import { CycleSetupWorkspace } from './CycleSetupWorkspace'
import { InstructorWorkspace } from './InstructorWorkspace'
import { requestAccessCodeLogin, claimInitialAccessManager, exchangeGoogleIdentity, getMyNativAccess, listCycles, listGoogleAccessOptions, seedDemoEnvironment, type DemoAccount, type GoogleAccessOption, type NativSessionAccess } from './firebaseApi'
import { SecretaryWorkspace } from './SecretaryWorkspace'
import { StudentPreferenceWorkspace } from './StudentPreferenceWorkspace'

interface SessionProfile { user: User; access: NativSessionAccess }
const areaLabels: Partial<Record<RoleId, string>> = { student: 'הבחירות שלי', placement_coordinator: 'ניהול השיבוץ', appeal_reviewer: 'בדיקת ערעורים', access_manager: 'ניהול גישה', secretary: 'דיווחים למזכירות', course_instructor: 'הקורסים שלי' }
const areaOrder: RoleId[] = ['student', 'placement_coordinator', 'appeal_reviewer', 'secretary', 'course_instructor', 'access_manager']

function friendlyError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  return error.message.replace(/\s*\[\d+\]\s*$/, '').replace(/^Firebase:\s*/u, '')
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
  const [cyclesLoading, setCyclesLoading] = useState(false)
  const [cycles, setCycles] = useState<AssignmentCycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)
  const [coordinatorPage,setCoordinatorPage] = useState<'workflow'|'form'>('form')
  const [showArchive,setShowArchive] = useState(false)
  const visibleCycles=cycles.filter(c=>showArchive ? !isCurrentYearWindow(c.schoolYear) : isCurrentYearWindow(c.schoolYear))
  const [creatingCycle, setCreatingCycle] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState(firebaseConfigured ? 'אפשר להיכנס ולהמשיך.' : 'המערכת אינה זמינה כרגע.')
  const [authReload, setAuthReload] = useState(0)
  const [authError, setAuthError] = useState(false)
  const [alias, setAlias] = useState('')
  const [code, setCode] = useState('')
  const [logoResult, setLogoResult] = useState({ path: '', url: '' })
  const schoolLogo = logoResult.path === session?.access.organizationLogoPath ? logoResult.url : ''
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
      setCyclesLoading(Boolean(user))
      setSelectedCycleId(null)
      setCreatingCycle(false)
      setShowArchive(false)
      setAuthError(false)
      if (!user) return
      setMessage('טוען את סביבת העבודה שלך…')
      void withSessionTimeout(resolveSession(user, {
        getAccess: getMyNativAccess, listSchools: listGoogleAccessOptions,
        exchange: exchangeGoogleIdentity, signIn: (token) => signInWithCustomToken(auth, token),
        isCurrent: () => authRequest.current === requestId, allowExchange: !emulatorMode,
      })).then((result) => {
        if (authRequest.current !== requestId) return
        if ('schools' in result) { setOrganizationOptions(result.schools); setMessage('בחרו את בית הספר שאליו תרצו להיכנס.'); return }
        const { user: resolvedUser, access } = result
        if (auth.currentUser?.uid !== resolvedUser.uid) return
        setAuthenticatedUser(resolvedUser)
        setSession({ user: resolvedUser, access })
        setSelectedArea(areaOrder.find((role) => access.roles.includes(role)) ?? null)
        setMessage('')
        void withSessionTimeout(listCycles()).then((loaded) => { if (authRequest.current === requestId) { setCycles(loaded); setCyclesLoading(false); setSelectedCycleId(preferredCycleId(loaded)) } }).catch(() => { if (authRequest.current === requestId) { setAuthError(true); setMessage('לא ניתן לטעון את מחזורי השיבוץ. נסו שוב.'); } })
      }).catch((error: unknown) => { if (authRequest.current === requestId) { ++authRequest.current; setAuthError(true); setMessage(friendlyError(error, 'לא ניתן לטעון את ההרשאות.')) } })
    })
    if (emulatorMode) void seedDemoEnvironment().then((result) => setAccounts(result.accounts)).catch(() => setMessage('סביבת הבדיקה אינה זמינה.'))
    // Invalidate asynchronous session work when the subscription is replaced.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return () => { ++authRequest.current; unsubscribe() }
  }, [authReload])
  useEffect(() => {
    let active = true
    const path = session?.access.organizationLogoPath
    if (!emulatorMode && nativStorage && path && path.startsWith(`organizations/${session?.access.organizationId}/branding/`)) {
      void getDownloadURL(ref(nativStorage, path)).then((url) => { if (active) setLogoResult({ path, url }) }).catch(() => {})
    }
    return () => { active = false }
  }, [session?.access.organizationId, session?.access.organizationLogoPath])

  const availableAreas = useMemo(() => areaOrder.filter((role) => session?.access.roles.includes(role)), [session])
  async function refreshCycles(createdId?: string) { const loaded = await listCycles(); setCycles(loaded); setSelectedCycleId((current) => createdId ?? (current && loaded.some((cycle) => cycle.id === current) ? current : (showArchive ? loaded.find(c=>!isCurrentYearWindow(c.schoolYear))?.id ?? null : preferredCycleId(loaded)))); if(createdId){setCoordinatorPage('form');setShowArchive(false)}; setCreatingCycle(false) }

  async function login(account: DemoAccount) {
    if (!nativAuth || pending) return
    try { setPending(true); setMessage('נכנס למערכת…'); await signInWithEmailAndPassword(nativAuth, account.email, account.password) }
    catch (error) { setMessage(friendlyError(error, 'הכניסה נכשלה.')) }
    finally { setPending(false) }
  }
  async function loginWithCode() {
    if (!nativAuth || pending) return
    try {
      setPending(true); setMessage('נכנס למערכת…')
      const token = await requestAccessCodeLogin(alias.trim(), code)
      await signInWithCustomToken(nativAuth, token)
      setCode(''); setAuthReload((value) => value + 1)
    } catch { setMessage('הכניסה לא הושלמה. בדקו את השם והקוד האישי ונסו שוב. אם הבעיה נמשכת, פנו למנהל בית הספר.') }
    finally { setPending(false) }
  }
  async function loginWithGoogle() {
    if (!nativAuth || pending) return
    try { setPending(true); await signInWithPopup(nativAuth, new GoogleAuthProvider()) }
    catch (error) { setMessage(friendlyError(error, 'הכניסה נכשלה.')) }
    finally { setPending(false) }
  }
  async function chooseSchool() {
    if (pending) return
    try {
      setPending(true)
      const options = await listGoogleAccessOptions()
      setOrganizationOptions(options)
      setMessage(options.length ? 'בחרו את בית הספר שאליו תרצו להיכנס.' : 'לא נמצאו בתי ספר נוספים לחשבון. אפשר לצאת ולהיכנס עם פרטי בית הספר.')
    } catch { setMessage('לא ניתן לבחור בית ספר בחשבון זה. אפשר לצאת ולהיכנס בשם ובקוד האישי של בית הספר.') }
    finally { setPending(false) }
  }
  async function enterOrganization(option: GoogleAccessOption) {
    if (!nativAuth || pending) return
    try {
      setPending(true)
      setMessage(`נכנס לבית הספר ${option.name}…`)
      const customToken = await exchangeGoogleIdentity(option.id)
      await signInWithCustomToken(nativAuth, customToken)
      setAuthReload((value) => value + 1)
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

  return <div className={authenticatedUser ? 'app-shell work-shell' : 'app-shell login-shell'}>
    <header className="topbar">
      <a className="brand" href="#main" aria-label="נתיב — מערכת שיבוץ קורסי בחירה"><span className="brand-mark"><img src="/nativ-mark.png?v=65442c9" alt="" /></span><span><strong>נתיב</strong><small>מערכת שיבוץ קורסי בחירה</small></span></a>
      {session && <SchoolBrand className="school-brand" src={schoolLogo} name={session.access.organizationName} />}
    </header>
    <main id="main"><section className="mvp-shell" aria-labelledby="mvp-title">
    <div className="workspace-heading account-heading"><div className="account-title"><h2 id="mvp-title">{authenticatedUser ? (selectedArea ? areaLabels[selectedArea] : 'סביבת העבודה') : 'כניסה לנתיב'}</h2>{session?.access.displayName && <span className="account-name">{session.access.displayName}</span>}</div>{authenticatedUser && <button type="button" className="text-action" onClick={() => void navigate(logout)}>יציאה</button>}</div>
    {confirmation}
    {creatingCycle && <button className="text-action" onClick={() => void navigate(() => { setCreatingCycle(false); setSelectedCycleId(visibleCycles[0]?.id ?? null) })}>חזרה למחזור הקיים</button>}
    <p className="workspace-message" aria-live="polite" hidden={!message}>{message}</p>
    {session && cyclesLoading && !authError && <p role="status">טוען את מחזורי השיבוץ…</p>}
    {authError && <button type="button" className="secondary-action" onClick={() => setAuthReload((value) => value + 1)}>ניסיון חוזר</button>}
    {authenticatedUser && !session && authError && <button type="button" className="secondary-action" disabled={pending} onClick={() => void chooseSchool()}>בחירת בית ספר</button>}
    {!authenticatedUser && <form className="login-form" onSubmit={(event) => { event.preventDefault(); void loginWithCode() }}>
      <label>שם מלא<input autoComplete="username" value={alias} onChange={(event) => setAlias(event.target.value)} required minLength={2} disabled={pending} /></label>
      <label>סיסמה / קוד אישי<input type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4,8}" minLength={4} maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} required disabled={pending} aria-describedby="login-help" /></label>
      <p id="login-help">השם והקוד האישי שקיבלתם מבית הספר, כמו בכניסה לאדטרק.</p>
      <button type="submit" className="primary-action" disabled={pending || !firebaseConfigured}>{pending ? 'נכנס…' : 'כניסה'}</button>
    </form>}
    {!authenticatedUser && !emulatorMode && <button type="button" className="primary-action" disabled={pending} onClick={() => void loginWithGoogle()}>כניסה עם Google</button>}
    {authenticatedUser && !session && organizationOptions.length > 0 && <div className="workspace-card"><h3>בחירת בית ספר</h3><div className="organization-options">{organizationOptions.map((option) => <button type="button" className="secondary-action" disabled={pending} key={option.id} onClick={() => void enterOrganization(option)}>{option.name}</button>)}</div></div>}
    {!authenticatedUser && emulatorMode && <div className="demo-login-grid">{accounts.map((account) => <button type="button" disabled={pending} key={account.email} onClick={() => void login(account)}><span>{account.label.slice(0, 1)}</span><strong>כניסה כ{account.label}</strong></button>)}</div>}
    {session && !session.access.roles.length && <div className="workspace-card"><h3>עדיין לא הוקצה לך תפקיד בנתיב</h3><p>מנהל הגישה בבית הספר יכול להקצות לך תפקיד מתאים.</p>{session.access.coreRole === 'school_admin' && <button type="button" className="primary-action" disabled={pending} onClick={() => void activateInitialManager()}>הפעלת מנהל הגישה הראשון</button>}</div>}
    {session?.access.accessMode === 'read_only' && <p className="read-only-notice">המידע זמין לצפייה בלבד. לא ניתן לבצע שינויים כעת.</p>}
    {availableAreas.length > 1 && <nav className="role-navigation main-navigation" aria-label="בחירת סביבת עבודה">{availableAreas.map((role) => <button type="button" className={selectedArea === role ? 'active' : ''} aria-current={selectedArea === role ? 'page' : undefined} key={role} onClick={() => void navigate(() => setSelectedArea(role))}>{areaLabels[role]}</button>)}</nav>}
    {session && selectedArea && selectedArea !== 'access_manager' && !creatingCycle && <>
      <div className="cycle-toolbar"><nav className="role-navigation year-navigation" aria-label="תהליכים לפי שנים">{[false,true].map(archive=><button key={String(archive)} className={showArchive===archive?'active':''} aria-pressed={showArchive===archive} onClick={()=>void navigate(()=>{setShowArchive(archive);setSelectedCycleId(archive ? cycles.find(c=>!isCurrentYearWindow(c.schoolYear))?.id ?? null : preferredCycleId(cycles))})}>{archive?'ארכיון':'תהליכים אחרונים'}</button>)}</nav>
      {visibleCycles.length>0 && <label className="cycle-picker">מחזור<select value={selectedCycleId ?? ''} onChange={event=>{const id=event.target.value;void navigate(()=>setSelectedCycleId(id))}}>{[...new Set(visibleCycles.map(c=>c.schoolYear))].sort().reverse().map(year=><optgroup key={year} label={schoolYearLabel(year)}>{visibleCycles.filter(c=>c.schoolYear===year).map(c=><option key={c.id} value={c.id}>{schoolYearLabel(c.schoolYear)} · {c.termLabel}</option>)}</optgroup>)}</select></label>}
    {session && selectedArea === 'placement_coordinator' && (selectedCycleId || showArchive) && !creatingCycle && session.access.accessMode !== 'read_only' && <button type="button" className="secondary-action" onClick={() => void navigate(() => { setCreatingCycle(true); setShowArchive(false); setSelectedCycleId(null) })}>תהליך חדש</button>}
      </div>
      {showArchive && !cyclesLoading && !visibleCycles.length && <section className="workspace-card"><h2>ארכיון שנים קודמות</h2><p>אין עדיין תהליכים משנים קודמות בארכיון.</p></section>}
    </>}
    {session && selectedArea === 'placement_coordinator' && selectedCycleId && <nav className="role-navigation process-navigation" aria-label="ניהול תהליך בחירה"><button className={coordinatorPage==='form'?'active':''} onClick={()=>void navigate(()=>setCoordinatorPage('form'))}>הגדרות וטופס</button><button className={coordinatorPage==='workflow'?'active':''} onClick={()=>void navigate(()=>setCoordinatorPage('workflow'))}>שיבוץ ותוצאות</button></nav>}
    {session && !cyclesLoading && !authError && selectedArea && !selectedCycleId && !showArchive && !['access_manager', 'placement_coordinator'].includes(selectedArea) && <section className="workspace-card"><h2>אין מחזור שיבוץ זמין</h2><p>כאשר ייפתח מחזור מתאים הוא יופיע כאן.</p></section>}
    {session && !cyclesLoading && !authError && selectedArea && (selectedCycleId || ['access_manager', 'course_instructor', 'placement_coordinator'].includes(selectedArea)) && <ReadOnlyContext.Provider value={session.access.accessMode === 'read_only'}><fieldset key={`${session.user.uid}-${selectedArea}-${selectedCycleId ?? "new"}`} className="workspace-boundary">
      {selectedArea === 'placement_coordinator' && !selectedCycleId && !showArchive && <fieldset className="workspace-boundary" disabled={session.access.accessMode === 'read_only'}><CycleSetupWorkspace onChanged={refreshCycles} schoolName={session.access.organizationName} schoolLogo={schoolLogo} /></fieldset>}
      {selectedArea === 'placement_coordinator' && selectedCycleId && coordinatorPage === 'form' && <fieldset className="workspace-boundary" disabled={session.access.accessMode === 'read_only'}><CycleSetupWorkspace readOnly={session.access.accessMode === 'read_only'} cycle={cycles.find((cycle) => cycle.id === selectedCycleId)} onChanged={refreshCycles} schoolName={session.access.organizationName} schoolLogo={schoolLogo} /></fieldset>}
      {selectedArea === 'student' && selectedCycleId && <fieldset className="workspace-boundary" disabled={session.access.accessMode === 'read_only'}><StudentPreferenceWorkspace cycleId={selectedCycleId} readOnly={session.access.accessMode === 'read_only'} schoolName={session.access.organizationName} schoolLogo={schoolLogo} /></fieldset>}
      {selectedArea === 'placement_coordinator' && selectedCycleId && coordinatorPage === 'workflow' && <CoordinatorWorkflowWorkspace cycleId={selectedCycleId} onCycleChanged={refreshCycles} />}
      {selectedArea === 'appeal_reviewer' && selectedCycleId && <AppealReviewerWorkspace cycleId={selectedCycleId} />}
      {selectedArea === 'access_manager' && <AccessManagerWorkspace />}
      {selectedArea === 'secretary' && selectedCycleId && <SecretaryWorkspace cycleId={selectedCycleId} />}
      {selectedArea === 'course_instructor' && selectedCycleId && <InstructorWorkspace cycleId={selectedCycleId} />}
    </fieldset></ReadOnlyContext.Provider>}
    {!authenticatedUser && <p className="login-byline">מבית יובל פלטין · חינוך דינמי</p>}
  </section></main></div>
}
