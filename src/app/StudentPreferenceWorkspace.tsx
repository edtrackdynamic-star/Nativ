import { ChoiceForm } from './ChoiceForm'
import { SubmittedChoices } from './SubmittedChoices'
import { missingSubmissionRequirements, rankingsComplete } from './preferenceState'
import { useUnsavedChanges } from './interaction'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChoiceContext } from '../application/NativCommandService'
import type { ClusterPreference, PreferenceSubmission } from '../domain/preferences'
import type { AssignmentCycle } from '../domain/cycle'
import { choiceAcceptsResponses, choiceDeadlinePassed } from '../domain/choiceDeadline'
import { formatIsraelDateTime } from './israelDateTime'
import { todayWeekdayIsrael, weekdayNames, weeklySlotLabel } from '../domain/weeklySlot'
import type { WorkflowState } from '../domain/workflow'
import { downloadCycleDocument, getChoiceContext, getCycle, getWorkflow, listMySubmissions, savePreferenceDraft, submitAppeal, submitPreferenceDraft } from './firebaseApi'

interface StudentPreferenceWorkspaceProps { cycleId: string; readOnly?: boolean; schoolName?: string; schoolLogo?: string }

function saveFailureMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) return 'החיבור לשרת אינו יציב. בדקו את החיבור ונסו שוב.'
  if (code.includes('aborted')) return 'הטיוטה השתנתה בחלון אחר. העתיקו את תשובותיכם לפני רענון הטופס.'
  const message = error instanceof Error ? error.message : ''
  return /[\u0590-\u05FF]/.test(message) ? message : 'בדקו את החיבור ונסו שוב. אם התקלה נמשכת, פנו לרכז.'
}

export function StudentPreferenceWorkspace({ cycleId, readOnly = false, schoolName, schoolLogo }: StudentPreferenceWorkspaceProps) {
  const [context, setContext] = useState<ChoiceContext | null>(null)
  const [cycle, setCycle] = useState<AssignmentCycle | null>(null)
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null)
  const [preferences, setPreferences] = useState<ClusterPreference[]>([])
  const [submissionCount, setSubmissionCount] = useState(0)
  const [latestSubmission, setLatestSubmission] = useState<PreferenceSubmission | null>(null)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('טוען את טופס הבחירה…')
  const initialized = useRef(false)
  const alive = useRef(true)
  const busy = useRef(false)
  const [failedSignature, setFailedSignature] = useState('')
  const [submittedSignature, setSubmittedSignature] = useState('')
  const [savedSignature, setSavedSignature] = useState('')
  const [appealPending, setAppealPending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState('')
  const [hasSavedDraft, setHasSavedDraft] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [now, setNow] = useState(() => new Date().toISOString())
  const draftVersionRef = useRef(0)
  const lastSavedSignature = useRef('')
  const hasDraftRef = useRef(false)
  const saveInFlight = useRef<Promise<void> | null>(null)
  const preferencesRef = useRef(preferences)
  const [appealDraft, setAppealDraft] = useState({ clusterId: '', requestedCourseId: '', reason: '' })

  useEffect(() => {
    alive.current = true
    void Promise.all([getChoiceContext(cycleId), listMySubmissions(cycleId), getCycle(cycleId), getWorkflow(cycleId, 'student')])
      .then(([choiceContext, submissions, loadedCycle, loadedWorkflow]) => {
        if (!alive.current) return
        const latest = [...submissions].filter((entry) => entry.status === 'submitted').sort((a,b) => b.submissionVersion - a.submissionVersion)[0]
        setLatestSubmission(latest ?? null)
        setEditing(false)
        setSubmittedSignature(latest ? JSON.stringify(latest.preferences) : '')
        const draft = submissions.find((submission) => submission.status === 'draft')
        setContext(choiceContext)
        setCycle(loadedCycle)
        setWorkflow(loadedWorkflow)
        const previousPreferences = draft?.preferences ?? latest?.preferences
        const initialPreferences = choiceContext.catalog.clusters.map((cluster) => previousPreferences?.find(p => p.clusterId === cluster.clusterId) ?? ({
          clusterId: cluster.clusterId,
          rankings: Array.from({ length: cluster.requiredRankingCount }, (_, index) => ({ courseId: '', rank: index + 1 })),
        }))
        setPreferences(initialPreferences)
        preferencesRef.current = initialPreferences
        lastSavedSignature.current = JSON.stringify(previousPreferences ?? initialPreferences)
        setSavedSignature(JSON.stringify(previousPreferences ?? initialPreferences))
        draftVersionRef.current = draft?.version ?? 0
        hasDraftRef.current = Boolean(draft)
        setHasSavedDraft(Boolean(draft))
        setDraftSavedAt(draft?.updatedAt ?? '')
        setSubmissionCount(latest?.submissionVersion ?? 0)
        setMessage(loadedCycle.status === 'choice_open' ? (draft ? 'הטיוטה האחרונה נטענה.' : 'אפשר להתחיל לדרג. הטופס יישמר אוטומטית.') : '')
        initialized.current = true
      })
      .catch(() => { if (alive.current) setMessage('טעינת הטופס נכשלה. יש לרענן ולנסות שוב.') })
    return () => { alive.current = false; initialized.current = false }
  }, [cycleId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date().toISOString())
      void getCycle(cycleId).then(updated => { if (alive.current) setCycle(updated) }).catch(() => undefined)
    }, 30000)
    return () => window.clearInterval(timer)
  }, [cycleId])

  const signature = JSON.stringify(preferences)
  const isSubmitted = Boolean(submittedSignature && signature === submittedSignature)
  useUnsavedChanges(Boolean(context) && (signature !== savedSignature || saving || submitting))
  const complete = useMemo(() => rankingsComplete(context?.catalog.clusters ?? [], preferences), [context, preferences])
  const missingRequirements = useMemo(() => missingSubmissionRequirements(context?.catalog.clusters ?? [], preferences), [context, preferences])
  const deadlinePassed = Boolean(cycle && choiceDeadlinePassed(cycle, now))
  const canEdit = Boolean(cycle && !readOnly && choiceAcceptsResponses(cycle, now))

  const saveDraftNow = useCallback(async () => {
    if (saveInFlight.current) return saveInFlight.current
    const snapshot = preferencesRef.current
    const snapshotSignature = JSON.stringify(snapshot)
    if (hasDraftRef.current && snapshotSignature === lastSavedSignature.current) return
    const task = (async () => {
      setSaving(true)
      setSaveError('')
      try {
        const draft = await savePreferenceDraft(cycleId, snapshot, draftVersionRef.current)
        if (!alive.current) return
        lastSavedSignature.current = snapshotSignature
        draftVersionRef.current = draft.version
        hasDraftRef.current = true
        setHasSavedDraft(true)
        setSavedSignature(snapshotSignature)
        setDraftSavedAt(draft.updatedAt)
        setFailedSignature('')
      } catch (error) {
        if (alive.current) {
          setFailedSignature(snapshotSignature)
          setSaveError(saveFailureMessage(error))
        }
        throw error
      } finally {
        saveInFlight.current = null
        if (alive.current) setSaving(false)
      }
    })()
    saveInFlight.current = task
    return task
  }, [cycleId])

  useEffect(() => {
    if (readOnly || (latestSubmission && !editing) || submitting || !initialized.current || !context?.catalog.clusters.length || !cycle || !choiceAcceptsResponses(cycle, now) || saving || signature === lastSavedSignature.current || signature === failedSignature) return
    const timer = window.setTimeout(() => {
      if (!alive.current || saveInFlight.current) return
      void saveDraftNow().catch(() => undefined)
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [context, cycle, cycleId, signature, saving, submitting, readOnly, latestSubmission, editing, failedSignature, now, saveDraftNow])

  async function saveManually() {
    if (readOnly || saving || submitting || !cycle || !choiceAcceptsResponses(cycle, new Date().toISOString())) return
    try { await saveDraftNow() } catch { /* The actionable error is shown beside the form. */ }
  }

  async function submit() {
    if (!complete || missingRequirements.length || busy.current || readOnly || isSubmitted || !cycle || !choiceAcceptsResponses(cycle, new Date().toISOString())) return
    busy.current = true
    let draftSaved = false
    try {
      setSubmitting(true)
      setMessage('מגיש את הבחירות…')
      if (saveInFlight.current) await saveInFlight.current.catch(() => undefined)
      await saveDraftNow()
      if (!alive.current) return
      draftSaved = true
      const submitted = await submitPreferenceDraft(cycleId, draftVersionRef.current, submissionCount + 1)
      if (!alive.current) return
      setLatestSubmission(submitted)
      setEditing(false)
      setSubmittedSignature(JSON.stringify(submitted.preferences))
      setSubmissionCount(submitted.submissionVersion)
      setMessage('הטופס הוגש בהצלחה והבחירות נשמרו.')
    } catch (error) { setMessage(`${draftSaved ? 'הטיוטה נשמרה, אך ההגשה לא הושלמה. ' : 'שמירת הטיוטה וההגשה לא הושלמו. '}${saveFailureMessage(error)}`) }
    finally { busy.current = false; if (alive.current) setSubmitting(false) }
  }

  async function sendAppeal() {
    if (appealPending || readOnly || !appealDraft.clusterId || !appealDraft.requestedCourseId || !appealDraft.reason.trim()) return
    try {
      setAppealPending(true)
      await submitAppeal(cycleId, appealDraft.clusterId, appealDraft.requestedCourseId, appealDraft.reason)
      setWorkflow(await getWorkflow(cycleId, 'student'))
      setMessage('הערעור הוגש בהצלחה. ניתן לעקוב אחר מצבו כאן.')
      setAppealDraft({ clusterId: '', requestedCourseId: '', reason: '' })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'הגשת הערעור נכשלה') } finally { setAppealPending(false) }
  }

  if (!context || !cycle || !workflow) return <section className="workspace-card"><p aria-live="polite">{message}</p></section>

  if (['published', 'appeals', 'closed'].includes(cycle.status)) {
    const assignments = workflow.assignmentRun?.assignments ?? []
    if (!assignments.length) return <section className="workspace-card" aria-label="מצב השיבוץ שלי"><h2>השיבוץ שלי</h2><p role="status">השיבוץ פורסם, אך לא נמצא עבורך קורס משובץ. פנו לרכז השיבוץ לבירור.</p>{latestSubmission && <SubmittedChoices clusters={latestSubmission.catalogSnapshot} preferences={latestSubmission.preferences} submittedAt={latestSubmission.submittedAt} canEdit={false} onEdit={() => undefined} editClosedReason="תקופת הבחירה הסתיימה." schoolName={schoolName} schoolLogo={schoolLogo} generated={latestSubmission.source === 'demo_seed'} />}</section>
    const today = todayWeekdayIsrael()
    const todayAssignments = assignments.filter(assignment => context.catalog.clusters.find(cluster => cluster.clusterId === assignment.clusterId)?.weeklySlot?.weekday === today)
    const appealDeadlinePassed = Boolean(cycle.appealDeadlineEnabled && cycle.appealClosesAt && new Date(cycle.appealClosesAt).getTime() <= new Date(now).getTime())
    const selectedCluster = context.catalog.clusters.find((cluster) => cluster.clusterId === appealDraft.clusterId)
    const currentCourseId = assignments.find((entry) => entry.clusterId === appealDraft.clusterId)?.courseId
    return <section className="workspace-card" aria-labelledby="student-result-title"><div className="workspace-heading"><div><span className="eyebrow">אזור תלמיד</span><h2 id="student-result-title">השיבוץ שלי</h2></div><span className="status-pill">{cycle.status === 'appeals' ? 'ערעורים פתוחים' : 'התהליך מתקדם'}</span></div><p className="workspace-message" aria-live="polite">{message}</p>
      <section className="daily-course-panel"><h3>הקורס שלי היום · {weekdayNames[today]}</h3>{todayAssignments.length ? todayAssignments.map(assignment => { const cluster = context.catalog.clusters.find(entry => entry.clusterId === assignment.clusterId); const course = cluster?.courses.find(entry => entry.courseId === assignment.courseId); return <p key={assignment.clusterId}><strong>{course?.label ?? 'קורס בחירה'}</strong> · {weeklySlotLabel(cluster?.weeklySlot)}</p> }) : <p>אין לך קורס בחירה מתוזמן היום.</p>}</section>
      <h3>הלוח השבועי שלי</h3><div className="result-grid">{assignments.length ? [...assignments].sort((left,right) => (context.catalog.clusters.find(c => c.clusterId === left.clusterId)?.weeklySlot?.weekday ?? 8) - (context.catalog.clusters.find(c => c.clusterId === right.clusterId)?.weeklySlot?.weekday ?? 8)).map((assignment) => {
        const cluster = context.catalog.clusters.find((entry) => entry.clusterId === assignment.clusterId)
        const course = cluster?.courses.find((entry) => entry.courseId === assignment.courseId)
        return <article className="cluster-card" key={assignment.clusterId}>
          <h3>{cluster?.label}</h3>
          <strong>{course?.label ?? 'הקורס שנבחר'}</strong>
          <p>{weeklySlotLabel(cluster?.weeklySlot)}</p>
          {course?.instructorNames?.length ? <p>בהנחיית {course.instructorNames.join(', ')}</p> : null}
          {course?.description ? <details><summary>פרטי הקורס</summary><p>{course.description}</p></details> : null}
        </article>
      }) : <p>השיבוץ טרם פורסם.</p>}</div>
      {workflow.notifications.filter((entry) => entry.channel === 'in_app').length > 0 && <div className="workflow-section"><h3>הודעות</h3>{workflow.notifications.filter((entry) => entry.channel === 'in_app').map((notification) => <article className="workflow-item" key={notification.id}><strong>{notification.subject}</strong><p>{notification.body}</p></article>)}</div>}
      {cycle.status === 'appeals' && <div className="workflow-section"><h3>הגשת ערעור</h3>{cycle.appealDeadlineEnabled && cycle.appealClosesAt && <p role="status">{appealDeadlinePassed ? 'מועד הגשת ערעורים חדשים הסתיים' : 'אפשר להגיש ערעור עד'}: {formatIsraelDateTime(cycle.appealClosesAt)}{appealDeadlinePassed ? '. פנו לרכז אם דרושה הארכה.' : ''}</p>}{!appealDeadlinePassed && <><label className="rationale-field"><span>מקבץ</span><select value={appealDraft.clusterId} onChange={(event) => setAppealDraft({ clusterId: event.target.value, requestedCourseId: '', reason: appealDraft.reason })}><option value="">בחירת מקבץ</option>{assignments.map((assignment) => <option key={assignment.clusterId} value={assignment.clusterId}>{context.catalog.clusters.find((cluster) => cluster.clusterId === assignment.clusterId)?.label}</option>)}</select></label><label className="rationale-field"><span>הקורס המבוקש</span><select value={appealDraft.requestedCourseId} onChange={(event) => setAppealDraft({ ...appealDraft, requestedCourseId: event.target.value })}><option value="">בחירת קורס</option>{selectedCluster?.courses.filter((course) => course.courseId !== currentCourseId).map((course) => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}</select></label><label className="rationale-field"><span>סיבת הערעור</span><textarea rows={3} value={appealDraft.reason} onChange={(event) => setAppealDraft({ ...appealDraft, reason: event.target.value })} /></label><button type="button" className="primary-action" disabled={appealPending || !appealDraft.clusterId || !appealDraft.requestedCourseId || !appealDraft.reason.trim()} onClick={() => void sendAppeal()}>הגשת ערעור</button></>}{workflow.appeals.map((appeal) => <div className="student-appeal-status" key={appeal.id}><strong>{context.catalog.clusters.find((cluster) => cluster.clusterId === appeal.clusterId)?.label}: {{ submitted: 'נשלח לבדיקה', approved_pending_execution: 'אושר וממתין לביצוע', rejected: 'נדחה', executed: 'השינוי בוצע' }[appeal.status]}</strong>{appeal.decision?.reason && <p>{appeal.decision.reason}</p>}</div>)}</div>}
    </section>
  }

  if (latestSubmission && (!editing || !canEdit)) {
    const editClosedReason = readOnly ? 'הצפייה בחשבון זה היא לקריאה בלבד.' : deadlinePassed ? 'מועד עריכת הבחירות הסתיים. אם הרכז יאריך את מועד ההגשה, אפשר יהיה לערוך שוב.' : cycle.status === 'assignment' ? 'השיבוץ החל, ולכן אי אפשר עוד לשנות את הבחירות.' : 'תקופת הבחירה נסגרה, ולכן אי אפשר עוד לשנות את הבחירות.'
    const generated = latestSubmission.source === 'demo_seed'
    const statusMessage = cycle.status === 'assignment'
      ? generated ? 'הבחירות לדוגמה נכללות בתהליך השיבוץ. השיבוץ שלך יופיע כאן לאחר פרסום התוצאות.' : 'הבחירות שלך נקלטו ונמצאות בתהליך שיבוץ. השיבוץ שלך יופיע כאן לאחר פרסום התוצאות.'
      : cycle.status === 'choice_closed'
        ? generated ? 'הבחירות לדוגמה הועברו לשיבוץ. השיבוץ שלך יופיע כאן לאחר פרסום התוצאות.' : 'הבחירות שלך נקלטו והועברו לשיבוץ. השיבוץ שלך יופיע כאן לאחר פרסום התוצאות.'
        : undefined
    return <section className="workspace-card"><SubmittedChoices clusters={latestSubmission.catalogSnapshot} preferences={latestSubmission.preferences} submittedAt={latestSubmission.submittedAt} canEdit={canEdit} onEdit={() => setEditing(true)} editClosedReason={editClosedReason} pendingDraft={signature !== submittedSignature} schoolName={schoolName} schoolLogo={schoolLogo} generated={latestSubmission.source === 'demo_seed'} statusMessage={statusMessage} /></section>
  }

  if (!context.catalog.clusters.length) return <section className="workspace-card"><h2>הבחירות שלי</h2><p>אין מקבצים פתוחים לכיתתך בתהליך הזה. לבדיקת שיוך הכיתה אפשר לפנות לרכז.</p></section>

  if (cycle.status !== 'choice_open' || deadlinePassed) return <section className="workspace-card"><h2>הבחירות שלי</h2><p>{deadlinePassed ? 'מועד ההגשה הסתיים.' : cycle.status === 'assignment' ? 'השיבוץ כבר החל.' : 'תקופת הבחירה נסגרה.'} לא הוגשו בחירות במחזור הזה. פנו לרכז אם דרוש סיוע.</p></section>

  const submitHint = submitting ? <p>מגיש את הבחירות…</p> : isSubmitted ? <p>הבחירות האלה כבר הוגשו.</p> : readOnly ? <p>הצפייה בחשבון זה היא לקריאה בלבד.</p> : !complete || missingRequirements.length ? <><p>כדי להגיש, השלימו את הפרטים הבאים:</p><ul>{missingRequirements.map((issue, index) => <li key={`${issue.clusterId}-${index}`}><a href={`#choice-cluster-${issue.clusterId}`}>{issue.message}</a></li>)}</ul></> : <p>כל הבחירות הושלמו. אפשר להגיש את הטופס.</p>

  return (
    <section className="workspace-card" aria-label="טופס בחירה">
      <div className="workspace-heading">
        <div><span className="eyebrow">אזור תלמיד</span><strong>הבחירות שלי</strong></div>
        <span className="status-pill">{isSubmitted ? 'הוגש' : submissionCount ? 'שינויים שטרם הוגשו' : 'טיוטה'}</span>
      </div>
      <p className="workspace-message" aria-live="polite">{message}</p>
      {cycle.choiceDeadlineEnabled && cycle.choiceClosesAt && <p className={`choice-deadline ${deadlinePassed ? 'expired' : ''}`} role="status">{deadlinePassed ? 'מועד ההגשה הסתיים' : 'ניתן להגיש עד'}: {formatIsraelDateTime(cycle.choiceClosesAt)}{deadlinePassed && '. הבחירות שהוגשו נשמרו. אם המועד יוארך, תוכלו להמשיך לאחר רענון.'}</p>}
      <p className="draft-save-status" role="status" aria-live="polite">{saving ? 'שומר טיוטה…' : failedSignature === signature ? `שמירת הטיוטה נכשלה: ${saveError}. הבחירות נשארו במסך; תקנו את הבעיה ונסו לשמור שוב.` : signature !== savedSignature ? 'יש שינויים שטרם נשמרו.' : isSubmitted ? 'הבחירות הוגשו ונשמרו.' : hasSavedDraft ? `הטיוטה נשמרה${draftSavedAt ? ` · ${formatIsraelDateTime(draftSavedAt)}` : ''}.` : 'הבחירות טרם נשמרו כטיוטה.'}</p>
      <p>{preferences.reduce((sum, entry) => sum + entry.rankings.filter((ranking) => ranking.courseId).length, 0)} מתוך {context.catalog.clusters.reduce((sum, entry) => sum + entry.requiredRankingCount, 0)} בחירות הושלמו</p>
      <ChoiceForm clusters={context.catalog.clusters} design={context.catalog.formDesign} preferences={preferences} onChange={(next) => { preferencesRef.current = next; setPreferences(next) }} onOpenDocument={()=>void downloadCycleDocument(cycle.id).catch(()=>setMessage('פתיחת המסמך נכשלה. בקשו מהרכז לבדוק את הקובץ.'))} schoolName={schoolName} schoolLogo={schoolLogo} onSubmit={()=>void submit()} onSaveDraft={()=>void saveManually()} disabled={readOnly || submitting || deadlinePassed} saveDisabled={readOnly || saving || submitting || deadlinePassed} submitDisabled={!complete || Boolean(missingRequirements.length) || submitting || isSubmitted || readOnly || deadlinePassed} submitHint={submitHint} />
      <div className="workspace-actions">
        <span>{isSubmitted ? 'הבחירות המוצגות הוגשו ונשמרו' : submissionCount ? 'יש להגיש מחדש כדי לעדכן את הבחירות שהוגשו' : 'הבחירות טרם הוגשו'}</span>
      </div>
    </section>
  )
}
