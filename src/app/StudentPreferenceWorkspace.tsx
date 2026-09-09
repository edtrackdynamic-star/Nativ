import { ChoiceForm } from './ChoiceForm'
import { rankingsComplete } from './preferenceState'
import { useUnsavedChanges } from './interaction'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChoiceContext } from '../application/NativCommandService'
import type { ClusterPreference } from '../domain/preferences'
import type { AssignmentCycle } from '../domain/cycle'
import type { WorkflowState } from '../domain/workflow'
import { getChoiceContext, getCycle, getWorkflow, listMySubmissions, savePreferenceDraft, submitAppeal, submitPreferenceDraft } from './firebaseApi'

interface StudentPreferenceWorkspaceProps { cycleId: string; readOnly?: boolean }

export function StudentPreferenceWorkspace({ cycleId, readOnly = false }: StudentPreferenceWorkspaceProps) {
  const [context, setContext] = useState<ChoiceContext | null>(null)
  const [cycle, setCycle] = useState<AssignmentCycle | null>(null)
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null)
  const [preferences, setPreferences] = useState<ClusterPreference[]>([])
  const [submissionCount, setSubmissionCount] = useState(0)
  const [message, setMessage] = useState('טוען את טופס הבחירה…')
  const initialized = useRef(false)
  const alive = useRef(true)
  const busy = useRef(false)
  const [failedSignature, setFailedSignature] = useState('')
  const [submittedSignature, setSubmittedSignature] = useState('')
  const [savedSignature, setSavedSignature] = useState('')
  const [appealPending, setAppealPending] = useState(false)
  const [saving, setSaving] = useState(false)
  const draftVersionRef = useRef(0)
  const lastSavedSignature = useRef('')
  const [appealDraft, setAppealDraft] = useState({ clusterId: '', requestedCourseId: '', reason: '' })

  useEffect(() => {
    alive.current = true
    void Promise.all([getChoiceContext(cycleId), listMySubmissions(cycleId), getCycle(cycleId), getWorkflow(cycleId, 'student')])
      .then(([choiceContext, submissions, loadedCycle, loadedWorkflow]) => {
        if (!alive.current) return
        const latest = [...submissions].filter((entry) => entry.status === 'submitted').sort((a,b) => b.submissionVersion - a.submissionVersion)[0]
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
        lastSavedSignature.current = JSON.stringify(previousPreferences ?? initialPreferences)
        setSavedSignature(JSON.stringify(previousPreferences ?? initialPreferences))
        draftVersionRef.current = draft?.version ?? 0
        setSubmissionCount(latest?.submissionVersion ?? 0)
        setMessage(loadedCycle.status === 'choice_open' ? (draft ? 'הטיוטה האחרונה נטענה.' : 'אפשר להתחיל לדרג. הטופס יישמר אוטומטית.') : 'טופס הבחירה המקורי נשמר לקריאה; מוצג גם מצב השיבוץ העדכני.')
        initialized.current = true
      })
      .catch(() => { if (alive.current) setMessage('טעינת הטופס נכשלה. יש לרענן ולנסות שוב.') })
    return () => { alive.current = false; initialized.current = false }
  }, [cycleId])

  const signature = JSON.stringify(preferences)
  const isSubmitted = Boolean(submittedSignature && signature === submittedSignature)
  useUnsavedChanges(Boolean(context) && (signature !== savedSignature || saving))
  const complete = useMemo(() => rankingsComplete(context?.catalog.clusters ?? [], preferences), [context, preferences])

  useEffect(() => {
    const signature = JSON.stringify(preferences)
    if (readOnly || !initialized.current || !context?.catalog.clusters.length || cycle?.status !== 'choice_open' || saving || signature === lastSavedSignature.current || signature === failedSignature) return
    const timer = window.setTimeout(() => {
      if (busy.current || !alive.current) return
      busy.current = true
      setSaving(true)
      setMessage('שומר טיוטה…')
      void savePreferenceDraft(cycleId, preferences, draftVersionRef.current)
        .then((draft) => { if (!alive.current) return; lastSavedSignature.current = signature; setSavedSignature(signature); draftVersionRef.current = draft.version; setMessage('הטיוטה נשמרה אוטומטית.') })
        .catch(() => { if (alive.current) { setFailedSignature(signature); setMessage('שמירת הטיוטה נכשלה. הבחירות נשארו במסך; אפשר לנסות שוב.') } })
        .finally(() => { busy.current = false; if (alive.current) setSaving(false) })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [context, cycle, cycleId, preferences, saving, readOnly, failedSignature])

  async function submit() {
    if (!complete || busy.current || readOnly || isSubmitted) return
    busy.current = true
    try {
      setSaving(true)
      setMessage('שומר ומגיש…')
      const saved = await savePreferenceDraft(cycleId, preferences, draftVersionRef.current)
      if (!alive.current) return
      lastSavedSignature.current = JSON.stringify(preferences)
      setSavedSignature(JSON.stringify(preferences))
      draftVersionRef.current = saved.version
      const submitted = await submitPreferenceDraft(cycleId, saved.version, submissionCount + 1)
      if (!alive.current) return
      setSubmittedSignature(JSON.stringify(submitted.preferences))
      setSubmissionCount(submitted.submissionVersion)
      setMessage('הטופס הוגש בהצלחה והבחירות נשמרו.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'הגשת הטופס נכשלה') }
    finally { busy.current = false; if (alive.current) setSaving(false) }
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

  if (cycle.status !== 'choice_open') {
    const assignments = workflow.assignmentRun?.assignments ?? []
    const selectedCluster = context.catalog.clusters.find((cluster) => cluster.clusterId === appealDraft.clusterId)
    const currentCourseId = assignments.find((entry) => entry.clusterId === appealDraft.clusterId)?.courseId
    return <section className="workspace-card" aria-labelledby="student-result-title"><div className="workspace-heading"><div><span className="eyebrow">אזור תלמיד</span><h2 id="student-result-title">השיבוץ שלי</h2></div><span className="status-pill">{cycle.status === 'appeals' ? 'ערעורים פתוחים' : 'התהליך מתקדם'}</span></div><p className="workspace-message" aria-live="polite">{message}</p>
      <div className="result-grid">{assignments.length ? assignments.map((assignment) => <article className="cluster-card" key={assignment.clusterId}><h3>{context.catalog.clusters.find((cluster) => cluster.clusterId === assignment.clusterId)?.label}</h3><strong>{context.catalog.clusters.flatMap((cluster) => cluster.courses).find((course) => course.courseId === assignment.courseId)?.label ?? 'הקורס שנבחר'}</strong></article>) : <p>השיבוץ טרם פורסם.</p>}</div>
      {workflow.notifications.filter((entry) => entry.channel === 'in_app').length > 0 && <div className="workflow-section"><h3>הודעות</h3>{workflow.notifications.filter((entry) => entry.channel === 'in_app').map((notification) => <article className="workflow-item" key={notification.id}><strong>{notification.subject}</strong><p>{notification.body}</p></article>)}</div>}
      {cycle.status === 'appeals' && <div className="workflow-section"><h3>הגשת ערעור</h3><label className="rationale-field"><span>מקבץ</span><select value={appealDraft.clusterId} onChange={(event) => setAppealDraft({ clusterId: event.target.value, requestedCourseId: '', reason: appealDraft.reason })}><option value="">בחירת מקבץ</option>{assignments.map((assignment) => <option key={assignment.clusterId} value={assignment.clusterId}>{context.catalog.clusters.find((cluster) => cluster.clusterId === assignment.clusterId)?.label}</option>)}</select></label><label className="rationale-field"><span>הקורס המבוקש</span><select value={appealDraft.requestedCourseId} onChange={(event) => setAppealDraft({ ...appealDraft, requestedCourseId: event.target.value })}><option value="">בחירת קורס</option>{selectedCluster?.courses.filter((course) => course.courseId !== currentCourseId).map((course) => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}</select></label><label className="rationale-field"><span>סיבת הערעור</span><textarea rows={3} value={appealDraft.reason} onChange={(event) => setAppealDraft({ ...appealDraft, reason: event.target.value })} /></label><button type="button" className="primary-action" disabled={appealPending || !appealDraft.clusterId || !appealDraft.requestedCourseId || !appealDraft.reason.trim()} onClick={() => void sendAppeal()}>הגשת ערעור</button>{workflow.appeals.map((appeal) => <p key={appeal.id}>{context.catalog.clusters.find((cluster) => cluster.clusterId === appeal.clusterId)?.label}: {{ submitted: 'נשלח לבדיקה', approved_pending_execution: 'אושר וממתין לביצוע', rejected: 'נדחה', executed: 'השינוי בוצע' }[appeal.status]}</p>)}</div>}
    </section>
  }

  if (!context.catalog.clusters.length) return <section className="workspace-card"><h2>הבחירות שלי</h2><p>אין מקבצים פתוחים לכיתתך בתהליך הזה. לבדיקת שיוך הכיתה אפשר לפנות לרכז.</p></section>

  return (
    <section className="workspace-card" aria-label="טופס בחירה">
      <div className="workspace-heading">
        <div><span className="eyebrow">אזור תלמיד</span><strong>הבחירות שלי</strong></div>
        <span className="status-pill">{isSubmitted ? 'הוגש' : submissionCount ? 'שינויים שטרם הוגשו' : 'טיוטה'}</span>
      </div>
      <p className="workspace-message" aria-live="polite">{message}</p>
      {failedSignature === signature && <button className="secondary-action" onClick={() => setFailedSignature('')}>ניסיון שמירה נוסף</button>}
      <p>{preferences.reduce((sum, entry) => sum + entry.rankings.filter((ranking) => ranking.courseId).length, 0)} מתוך {context.catalog.clusters.reduce((sum, entry) => sum + entry.requiredRankingCount, 0)} בחירות הושלמו</p>
      <ChoiceForm clusters={context.catalog.clusters} design={context.catalog.formDesign} preferences={preferences} onChange={setPreferences} onSubmit={()=>void submit()} disabled={readOnly || saving} submitDisabled={!complete || saving || isSubmitted || readOnly} />
      <div className="workspace-actions">
        <span>{isSubmitted ? 'הבחירות המוצגות הוגשו ונשמרו' : submissionCount ? 'יש להגיש מחדש כדי לעדכן את הבחירות שהוגשו' : 'הבחירות טרם הוגשו'}</span>
      </div>
    </section>
  )
}
