import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChoiceContext } from '../application/NativCommandService'
import type { ClusterPreference } from '../domain/preferences'
import type { AssignmentCycle } from '../domain/cycle'
import type { WorkflowState } from '../domain/workflow'
import { getChoiceContext, getCycle, getWorkflow, listMySubmissions, savePreferenceDraft, submitAppeal, submitPreferenceDraft } from './firebaseApi'

interface StudentPreferenceWorkspaceProps { cycleId: string }

export function StudentPreferenceWorkspace({ cycleId }: StudentPreferenceWorkspaceProps) {
  const [context, setContext] = useState<ChoiceContext | null>(null)
  const [cycle, setCycle] = useState<AssignmentCycle | null>(null)
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null)
  const [preferences, setPreferences] = useState<ClusterPreference[]>([])
  const [draftVersion, setDraftVersion] = useState(0)
  const [submissionCount, setSubmissionCount] = useState(0)
  const [message, setMessage] = useState('טוען את טופס הבחירה…')
  const initialized = useRef(false)
  const saving = useRef(false)
  const draftVersionRef = useRef(0)
  const [appealDraft, setAppealDraft] = useState({ clusterId: '', requestedCourseId: '', reason: '' })

  useEffect(() => {
    void Promise.all([getChoiceContext(cycleId), listMySubmissions(cycleId), getCycle(cycleId), getWorkflow(cycleId)])
      .then(([choiceContext, submissions, loadedCycle, loadedWorkflow]) => {
        const draft = submissions.find((submission) => submission.status === 'draft')
        setContext(choiceContext)
        setCycle(loadedCycle)
        setWorkflow(loadedWorkflow)
        setPreferences(draft?.preferences ?? choiceContext.catalog.clusters.map((cluster) => ({
          clusterId: cluster.clusterId,
          rankings: cluster.courses.slice(0, cluster.requiredRankingCount).map((course, index) => ({ courseId: course.courseId, rank: index + 1 })),
        })))
        setDraftVersion(draft?.version ?? 0)
        draftVersionRef.current = draft?.version ?? 0
        setSubmissionCount(submissions.filter((submission) => submission.status === 'submitted').length)
        setMessage(loadedCycle.status === 'choice_open' ? (draft ? 'הטיוטה האחרונה נטענה.' : 'אפשר להתחיל לדרג. הטופס יישמר אוטומטית.') : 'טופס הבחירה המקורי נשמר לקריאה; מוצג גם מצב השיבוץ העדכני.')
        initialized.current = true
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'טעינת הטופס נכשלה'))
  }, [cycleId])

  const complete = useMemo(() => context?.catalog.clusters.every((cluster) => {
    const entry = preferences.find((preference) => preference.clusterId === cluster.clusterId)
    return entry?.rankings.length === cluster.requiredRankingCount && new Set(entry.rankings.map((ranking) => ranking.courseId)).size === cluster.requiredRankingCount
  }) ?? false, [context, preferences])

  useEffect(() => {
    if (!initialized.current || !context || cycle?.status !== 'choice_open' || saving.current) return
    const timer = window.setTimeout(() => {
      saving.current = true
      setMessage('שומר טיוטה…')
      void savePreferenceDraft(cycleId, preferences, draftVersionRef.current)
        .then((draft) => { draftVersionRef.current = draft.version; setDraftVersion(draft.version); setMessage('הטיוטה נשמרה אוטומטית.') })
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'שמירת הטיוטה נכשלה'))
        .finally(() => { saving.current = false })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [context, cycle, cycleId, preferences])

  function updateRanking(clusterId: string, rank: number, courseId: string) {
    setPreferences((current) => current.map((preference) => preference.clusterId === clusterId
      ? { ...preference, rankings: preference.rankings.map((ranking) => ranking.rank === rank ? { ...ranking, courseId } : ranking) }
      : preference))
  }

  function updateRationale(clusterId: string, rationale: string) {
    setPreferences((current) => current.map((preference) => preference.clusterId === clusterId ? { ...preference, rationale } : preference))
  }

  async function submit() {
    if (!complete || saving.current) return
    try {
      saving.current = true
      setMessage('שומר ומגיש…')
      const saved = await savePreferenceDraft(cycleId, preferences, draftVersionRef.current)
      draftVersionRef.current = saved.version
      setDraftVersion(saved.version)
      const submitted = await submitPreferenceDraft(cycleId, saved.version, submissionCount + 1)
      setSubmissionCount(submitted.submissionVersion)
      setMessage(`הטופס הוגש בהצלחה. גרסת הגשה ${submitted.submissionVersion} נשמרה.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'הגשת הטופס נכשלה') }
    finally { saving.current = false }
  }

  async function sendAppeal() {
    if (!appealDraft.clusterId || !appealDraft.requestedCourseId || !appealDraft.reason.trim()) return
    try {
      const appeal = await submitAppeal(cycleId, appealDraft.clusterId, appealDraft.requestedCourseId, appealDraft.reason)
      setWorkflow(await getWorkflow(cycleId))
      setMessage(`הערעור הוגש ונשמר במזהה ${appeal.id.slice(0, 8)}.`)
      setAppealDraft({ clusterId: '', requestedCourseId: '', reason: '' })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'הגשת הערעור נכשלה') }
  }

  if (!context || !cycle || !workflow) return <section className="workspace-card"><p aria-live="polite">{message}</p></section>

  if (cycle.status !== 'choice_open') {
    const assignments = workflow.assignmentRun?.assignments ?? []
    const selectedCluster = context.catalog.clusters.find((cluster) => cluster.clusterId === appealDraft.clusterId)
    const currentCourseId = assignments.find((entry) => entry.clusterId === appealDraft.clusterId)?.courseId
    return <section className="workspace-card" aria-labelledby="student-result-title"><div className="workspace-heading"><div><span className="eyebrow">אזור תלמיד</span><h2 id="student-result-title">השיבוץ שלי</h2></div><span className="status-pill">{cycle.status === 'appeals' ? 'ערעורים פתוחים' : 'התהליך מתקדם'}</span></div><p className="workspace-message" aria-live="polite">{message}</p>
      <div className="result-grid">{assignments.length ? assignments.map((assignment) => <article className="cluster-card" key={assignment.clusterId}><h3>{context.catalog.clusters.find((cluster) => cluster.clusterId === assignment.clusterId)?.label}</h3><strong>{context.catalog.clusters.flatMap((cluster) => cluster.courses).find((course) => course.courseId === assignment.courseId)?.label ?? assignment.courseId}</strong><p>{assignment.explanation}</p></article>) : <p>השיבוץ טרם פורסם.</p>}</div>
      {cycle.status === 'appeals' && <div className="workflow-section"><h3>הגשת ערעור</h3><label className="rationale-field"><span>מקבץ</span><select value={appealDraft.clusterId} onChange={(event) => setAppealDraft({ clusterId: event.target.value, requestedCourseId: '', reason: appealDraft.reason })}><option value="">בחירת מקבץ</option>{assignments.map((assignment) => <option key={assignment.clusterId} value={assignment.clusterId}>{context.catalog.clusters.find((cluster) => cluster.clusterId === assignment.clusterId)?.label}</option>)}</select></label><label className="rationale-field"><span>הקורס המבוקש</span><select value={appealDraft.requestedCourseId} onChange={(event) => setAppealDraft({ ...appealDraft, requestedCourseId: event.target.value })}><option value="">בחירת קורס</option>{selectedCluster?.courses.filter((course) => course.courseId !== currentCourseId).map((course) => <option key={course.courseId} value={course.courseId}>{course.label}</option>)}</select></label><label className="rationale-field"><span>סיבת הערעור</span><textarea rows={3} value={appealDraft.reason} onChange={(event) => setAppealDraft({ ...appealDraft, reason: event.target.value })} /></label><button type="button" className="primary-action" onClick={() => void sendAppeal()}>הגשת ערעור</button>{workflow.appeals.map((appeal) => <p key={appeal.id}>ערעור {appeal.clusterId}: {appeal.status}</p>)}</div>}
    </section>
  }

  return (
    <section className="workspace-card" aria-labelledby="student-form-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">אזור תלמיד</span><h2 id="student-form-title">טופס הבחירה שלי</h2></div>
        <span className="status-pill">גרסת טיוטה {draftVersion}</span>
      </div>
      <p className="workspace-message" aria-live="polite">{message}</p>
      <div className="cluster-grid">
        {context.catalog.clusters.map((cluster) => {
          const preference = preferences.find((entry) => entry.clusterId === cluster.clusterId)
          return (
            <article className="cluster-card" key={cluster.clusterId}>
              <h3>{cluster.label}</h3>
              <p>יש לדרג {cluster.requiredRankingCount} קורסים. כל קורס יכול להופיע פעם אחת.</p>
              {Array.from({ length: cluster.requiredRankingCount }, (_, index) => index + 1).map((rank) => {
                const selected = preference?.rankings.find((entry) => entry.rank === rank)?.courseId ?? ''
                const usedElsewhere = new Set(preference?.rankings.filter((entry) => entry.rank !== rank).map((entry) => entry.courseId))
                return (
                  <label className="field-row" key={rank}><span>בחירה {rank}</span>
                    <select value={selected} onChange={(event) => updateRanking(cluster.clusterId, rank, event.target.value)}>
                      <option value="">בחרו קורס</option>
                      {cluster.courses.map((course) => <option key={course.courseId} value={course.courseId} disabled={usedElsewhere.has(course.courseId)}>{course.label}</option>)}
                    </select>
                  </label>
                )
              })}
              <label className="rationale-field"><span>מה חשוב לך בבחירה? <small>אופציונלי</small></span>
                <textarea rows={3} value={preference?.rationale ?? ''} onChange={(event) => updateRationale(cluster.clusterId, event.target.value)} placeholder="אפשר לשתף בשיקולים, בסקרנות או במטרה שלך" />
              </label>
            </article>
          )
        })}
      </div>
      <div className="workspace-actions">
        <button type="button" className="primary-action" onClick={() => void submit()} disabled={!complete}>אישור והגשת הבחירות</button>
        <span>{submissionCount ? `${submissionCount} גרסאות הוגשו ונשמרו` : 'טרם הוגשה גרסה'}</span>
      </div>
    </section>
  )
}
