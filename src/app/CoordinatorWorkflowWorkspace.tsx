import { ResultDelivery } from './ResultDelivery'
import { useReadOnly } from './readOnly'
import { useEffect, useState } from 'react'
import type { AssignmentCycle, CycleStatus } from '../domain/cycle'
import type { AiPriority } from '../domain/assignmentEngine'
import type { AuditEvent } from '../domain/types'
import type { AiEvaluation, WorkflowState } from '../domain/workflow'
import { needsIndividualAiReview } from '../domain/aiReview'
import { rejectAssignmentRun, analyzeAppeal, approveAiEvaluation, approveAiEvaluations, approveAssignmentRun, approveCapacityOverride, decideAppeal, executeAppealChange, generateAiEvaluations, getCycle, getCycleCatalog, getWorkflow, listAuditEvents, publishAssignments, transitionCycle } from './firebaseApi'
import { AppealDetails } from './AppealDetails'
import { ProposedAssignmentWorkspace } from './ProposedAssignmentWorkspace'
import { ResultExplorer } from './ResultExplorer'
import { AppealDeadlineControl } from './AppealDeadlineControl'
import { AppealDecisionControls } from './AppealDecisionControls'
import { StudentRoster } from './StudentRoster'
import { ManualAssignmentChange } from './ManualAssignmentChange'
import type { Course, CycleCatalogSnapshot } from '../domain/catalog'
import { useConfirmAction, useUnsavedChanges } from './interaction'
import { coordinatorStageProgress, type CoordinatorStageId } from './coordinatorStages'

const statusLabels: Record<CycleStatus, string> = { draft: 'טיוטה', choice_open: 'בחירה פתוחה', choice_closed: 'בחירה סגורה', assignment: 'בתהליך שיבוץ', published: 'פורסם', appeals: 'תקופת ערעורים', closed: 'נסגר' }
const actions: Partial<Record<CycleStatus, { to: CycleStatus; label: string; reason: string }>> = {
  choice_open: { to: 'choice_closed', label: 'סגירת הבחירה', reason: 'סיום תקופת הבחירה' }, choice_closed: { to: 'assignment', label: 'מעבר לשיבוץ', reason: 'פלטי AI נבדקו והקלט מוכן לשיבוץ' }, published: { to: 'appeals', label: 'פתיחת ערעורים', reason: 'פתיחת חלון הערעורים' }, appeals: { to: 'closed', label: 'סגירת המחזור', reason: 'סיום הטיפול בערעורים' },
}
const auditLabels: Record<string, string> = {
  'cycle.created': 'מחזור נוצר', 'catalog.saved': 'הקורסים נשמרו', 'course.meeting_place.updated': 'מקום המפגש עודכן', 'cycle.transitioned': 'מצב המחזור השתנה',
  'preference.draft.saved': 'טיוטת בחירה נשמרה', 'preference.submitted': 'טופס בחירה הוגש', 'ai.batch.generated': 'הערכות נוצרו',
  'ai.evaluation.approved': 'הערכת העדפות אושרה', 'assignment.run.executed': 'השיבוץ הורץ', 'assignment.run.approved': 'השיבוץ אושר',
  'assignment.run.selected': 'נבחרה גרסת שיבוץ', 'assignment.rejected': 'גרסת שיבוץ נדחתה',
  'assignment.published': 'השיבוץ פורסם', 'appeal.submitted': 'ערעור הוגש', 'appeal.impact_analyzed': 'השפעת ערעור נבדקה',
  'appeal.recommended': 'נשמרה המלצה לערעור', 'appeal.approved': 'ערעור אושר כהצעה', 'appeal.rejected': 'ערעור נדחה',
  'appeal.capacity_override.approved': 'חריגת קיבולת אושרה', 'appeal.change.executed': 'שינוי בעקבות ערעור בוצע',
  'assignment.manual_change.executed': 'שיבוץ תלמיד שונה ידנית',
}
async function loadWorkspace(cycleId: string) { const [cycle, audits, workflow, catalog] = await Promise.all([getCycle(cycleId), listAuditEvents(), getWorkflow(cycleId, 'coordinator'), getCycleCatalog(cycleId)]); return { cycle, audits, workflow, catalog } }

function EvaluationEditor({ evaluation, cycleId, clusterLabel, onSaved }: { evaluation: AiEvaluation; cycleId: string; clusterLabel: string; onSaved: (workflow: WorkflowState) => void }) {
  const readOnly = useReadOnly()
  const [priority, setPriority] = useState<AiPriority>(evaluation.approved?.priority ?? evaluation.raw.priority)
  const [summary, setSummary] = useState(evaluation.approved?.summary ?? evaluation.raw.summary)
  const initialCoursePriorities = evaluation.approved?.coursePriorities ?? evaluation.raw.coursePriorities
  const [coursePriorities, setCoursePriorities] = useState<Record<string, AiPriority>>(() => Object.fromEntries(initialCoursePriorities?.map((course) => [course.courseId, course.priority]) ?? []))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const hasCourseReview = Boolean(evaluation.raw.coursePriorities)
  const currentPriority: AiPriority = hasCourseReview ? Object.values(coursePriorities).includes('high') ? 'high' : Object.values(coursePriorities).includes('medium') ? 'medium' : Object.values(coursePriorities).includes('neutral') ? 'neutral' : 'negative' : priority
  const courseChanged = Boolean(initialCoursePriorities?.some((course) => coursePriorities[course.courseId] !== course.priority))
  useUnsavedChanges(courseChanged || (!hasCourseReview && priority !== (evaluation.approved?.priority ?? evaluation.raw.priority)) || summary !== (evaluation.approved?.summary ?? evaluation.raw.summary) || pending)
  async function save() { if (pending) return; setPending(true); try { onSaved(await approveAiEvaluation(cycleId, evaluation.id, currentPriority, summary, evaluation.raw.coursePriorities?.map((course) => ({ courseId: course.courseId, priority: coursePriorities[course.courseId] ?? 'neutral' })))); setError('') } catch (failure) { setError(failure instanceof Error ? failure.message : 'שמירת ההערכה נכשלה. יש לרענן ולנסות שוב.') } finally { setPending(false) } }
  return <article className="workflow-item evaluation-review" aria-label={`בדיקת העדפה במקבץ ${clusterLabel}`}>
    {error && <p role="alert">ההערכה לא נשמרה. {error}</p>}
    <div className="evaluation-review-header"><strong>{clusterLabel}</strong><small>מספר בדיקה {evaluation.anonymousStudentRef.slice(5, 13)}</small></div>
    <div className="evaluation-rationale"><span>דברי התלמיד/ה</span><p>{evaluation.input.rationale ?? 'לא נמסר נימוק — ההמלצה ניטרלית.'}</p></div>
    {hasCourseReview ? <><p className="evaluation-priority-hint">״שלילית״ מיועדת רק לקורס שהתלמיד/ה הסתייג/ה ממנו במפורש. השיבוץ ינסה קודם קורסים אחרים.</p><div className="evaluation-courses">{evaluation.input.courses?.filter((course) => course.rank !== null).sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0)).map((course) => <div className="evaluation-course" key={course.courseId}>
      <div className="evaluation-course-heading"><strong>{course.rank}. {course.label}</strong><span data-priority={coursePriorities[course.courseId] ?? 'neutral'}>{({ high: 'גבוהה', medium: 'בינונית', neutral: 'ניטרלית', negative: 'שלילית' } as const)[coursePriorities[course.courseId] ?? 'neutral']}</span></div>
      <label>עדיפות לקורס<select disabled={readOnly || pending} value={coursePriorities[course.courseId] ?? 'neutral'} onChange={(event) => setCoursePriorities((current) => ({ ...current, [course.courseId]: event.target.value as AiPriority }))}><option value="high">גבוהה</option><option value="medium">בינונית</option><option value="neutral">ניטרלית</option><option value="negative">שלילית</option></select></label>
      <details><summary>הסבר ההמלצה</summary><p>{evaluation.raw.coursePriorities?.find((entry) => entry.courseId === course.courseId)?.reason}</p></details>
    </div>)}</div></> : <><p>הערכה קודמת למקבץ כולו; בעת שיבוץ העדיפות תחול על כל הקורסים שדורגו בו.</p><label>עדיפות מאושרת<select disabled={readOnly || pending} value={priority} onChange={(event) => setPriority(event.target.value as AiPriority)}><option value="high">גבוהה</option><option value="medium">בינונית</option><option value="neutral">ניטרלית</option></select></label></>}
    <label className="evaluation-summary">סיכום לצוות<textarea disabled={readOnly || pending} rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
    <div className="evaluation-save"><button type="button" className="primary-action" disabled={readOnly || pending} onClick={() => void save()}>{pending ? 'שומר…' : evaluation.approved ? 'שמירת העדכון' : 'אישור ההערכה'}</button></div>
  </article>
}

export function CoordinatorWorkflowWorkspace({ cycleId, onCycleChanged }: { cycleId: string; onCycleChanged: () => Promise<void> }) {
  const readOnly = useReadOnly()
  const { confirm, confirmation } = useConfirmAction()
  const [selectedStage, setSelectedStage] = useState<CoordinatorStageId | null>(null)
  const [rejectionReason,setRejectionReason]=useState('')
  const [now,setNow]=useState(()=>Date.now())
  const [appealQuery, setAppealQuery] = useState('')
  const [appealStatus, setAppealStatus] = useState('submitted')
  const [evaluationFilter, setEvaluationFilter] = useState('pending')
  const [approvalMode, setApprovalMode] = useState<'individual' | 'exceptions' | 'all'>('individual')
  const [activeEvaluationId, setActiveEvaluationId] = useState<string | null>(null)
  const [cycleRevision, setCycleRevision] = useState(0)
  const [courses, setCourses] = useState<Course[]>([])
  const [catalogSnapshot, setCatalogSnapshot] = useState<CycleCatalogSnapshot | null>(null)
  const [cycle, setCycle] = useState<AssignmentCycle | null>(null); const [workflow, setWorkflow] = useState<WorkflowState | null>(null); const [audits, setAudits] = useState<AuditEvent[]>([]); const [courseLabels, setCourseLabels] = useState<Record<string, string>>({}); const [clusterLabels, setClusterLabels] = useState<Record<string, string>>({}); const [message, setMessage] = useState('טוען את לוח המחזור…'); const [pending, setPending] = useState(false)
  function applyLoaded(loaded: Awaited<ReturnType<typeof loadWorkspace>>) { setCycle(loaded.cycle); setAudits(loaded.audits); setWorkflow(loaded.workflow); setCourses(loaded.catalog.courses); setCatalogSnapshot(loaded.catalog.catalog); setCourseLabels(Object.fromEntries(loaded.catalog.courses.map((course) => [course.id, course.label]))); setClusterLabels(Object.fromEntries((loaded.catalog.catalog?.clusters ?? []).map((cluster) => [cluster.clusterId, cluster.label]))) }
  async function refresh() { try { const loaded = await loadWorkspace(cycleId); applyLoaded(loaded); setCycleRevision((value) => value + 1); setMessage('הנתונים מעודכנים.') } catch { setMessage('רענון הנתונים נכשל. יש לנסות שוב לפני המשך העבודה.') } }
  useEffect(() => { let active = true; void loadWorkspace(cycleId).then((loaded) => { if (active) { applyLoaded(loaded); setSelectedStage(null); setActiveEvaluationId(null); setMessage('הנתונים מעודכנים.') } }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'טעינת המחזור נכשלה') }); return () => { active = false } }, [cycleId])
  useEffect(() => { const timer=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(timer) },[])
  async function perform(operation: () => Promise<unknown>, success: string) { if (pending) return; let saved = false; try { setPending(true); await operation(); saved = true; await refresh(); await onCycleChanged(); setSelectedStage(null); setMessage(success) } catch (error) { setMessage(saved ? 'הפעולה נשמרה, אך רענון הנתונים נכשל. רעננו את המסך ובדקו את המצב לפני ניסיון נוסף.' : error instanceof Error ? error.message : 'הפעולה נכשלה. רעננו ובדקו את המצב לפני ניסיון נוסף.') } finally { setPending(false) } }
  async function selectTab(next: CoordinatorStageId) {
    if (next === (selectedStage ?? (cycle && workflow ? coordinatorStageProgress(cycle, workflow, now).current : 'students'))) return
    if (!window.dispatchEvent(new Event('nativ-before-navigation', { cancelable: true })) && !(await confirm('יש שינויים שלא נשמרו. לעבור ללשונית אחרת?'))) return
    setSelectedStage(next)
  }
  async function selectApprovalMode(next: typeof approvalMode) {
    if (next === approvalMode) return
    if (!window.dispatchEvent(new Event('nativ-before-navigation', { cancelable: true })) && !(await confirm('יש שינויים שלא נשמרו. לשנות את אופן הצגת ההערכות?'))) return
    setApprovalMode(next)
    setActiveEvaluationId(null)
  }
  async function selectEvaluation(nextId: string) {
    if (nextId === activeEvaluationId) return
    if (!window.dispatchEvent(new Event('nativ-before-navigation', { cancelable: true })) && !(await confirm('יש שינויים שלא נשמרו בהערכה זו. לעבור להערכה אחרת?'))) return
    setActiveEvaluationId(nextId)
  }
  async function selectEvaluationFilter(next: string) {
    if (next === evaluationFilter) return
    if (!window.dispatchEvent(new Event('nativ-before-navigation', { cancelable: true })) && !(await confirm('יש שינויים שלא נשמרו בהערכה זו. לשנות את התצוגה?'))) return
    setEvaluationFilter(next)
    setActiveEvaluationId(null)
  }
  async function confirmPerform(operation: () => Promise<unknown>, success: string, question: string) { if (pending || !(await confirm(question))) return; await perform(operation, success) }
  async function confirmBulkApproval(mode: 'clear_only' | 'all', count: number) {
    if (!window.dispatchEvent(new Event('nativ-before-navigation', { cancelable: true })) && !(await confirm('יש שינויים שלא נשמרו בהערכה פתוחה. להמשיך לאישור המרוכז בלעדיהם?'))) return
    await confirmPerform(() => approveAiEvaluations(cycleId, mode, workflow!.version), `אושרו ${count} הערכות. יתר ההערכות ממתינות לבדיקה.`, `לאשר יחד ${count} הערכות${mode === 'all' ? `, כולל ${requiredReviewCount - negativeReviewCount} מקרים שסומנו לבדיקה; ${negativeReviewCount} הערכות עם הסתייגות יישארו לבדיקה אישית` : ' שלא סומנו לבדיקה אישית'}?`)
  }
  if (!cycle || !workflow) return <section className="workspace-card"><p aria-live="polite">{message}</p></section>
  const action = actions[cycle.status]; const progress = coordinatorStageProgress(cycle, workflow, now); const tab = selectedStage ?? progress.current; const allAiApproved = progress.approved; const showTransition = (cycle.status === 'choice_open' && tab === 'students') || (cycle.status === 'choice_closed' && tab === 'evaluations') || (cycle.status === 'published' && tab === 'actual') || (cycle.status === 'appeals' && (tab === 'appeals' || (tab === 'delivery' && progress.openAppeals === 0))); const activeRunExclusions=workflow.assignmentRun?.excludedStudentClusterCount??0; const legacyEvaluationCount = workflow.aiEvaluations.filter((entry) => !entry.raw.coursePriorities).length
  const pendingEvaluations = workflow.aiEvaluations.filter((entry) => !entry.approved)
  const requiredReviewCount = pendingEvaluations.filter(needsIndividualAiReview).length
  const clearReviewCount = pendingEvaluations.length - requiredReviewCount
  const negativeReviewCount = pendingEvaluations.filter((entry) => entry.raw.coursePriorities?.some((course) => course.priority === 'negative')).length
  const bulkApprovalCount = pendingEvaluations.length - negativeReviewCount
  const visibleEvaluations = workflow.aiEvaluations.filter((entry) => (evaluationFilter === 'all' || !entry.approved) && (approvalMode !== 'exceptions' || needsIndividualAiReview(entry)))
  const activeEvaluationIndex = Math.max(0, visibleEvaluations.findIndex((entry) => entry.id === activeEvaluationId))
  const activeEvaluation = visibleEvaluations[activeEvaluationIndex]
  return <section className="workspace-card" aria-labelledby="coordinator-title">
    <div className="workspace-heading"><div><span className="eyebrow">אזור רכז שיבוץ</span><h2 id="coordinator-title">תהליך השיבוץ</h2><p>{cycle.schoolYear} · {cycle.termLabel}</p></div><span className="status-pill">{cycle.status==='choice_open' && cycle.choiceDeadlineEnabled && cycle.choiceClosesAt && new Date(cycle.choiceClosesAt).getTime() <= now ? 'מועד ההגשה חלף' : statusLabels[cycle.status]}</span></div><p className="workspace-message" aria-live="polite">{message}</p>
    {confirmation}
    <div className="coordinator-next"><span>השלב הנוכחי · {progress.stages.find((stage) => stage.id === progress.current)?.number} מתוך {progress.stages.length}</span><strong>{progress.stages.find((stage) => stage.id === progress.current)?.label}</strong><p>{progress.next}</p>{tab !== progress.current && <button type="button" className="secondary-action" onClick={() => void selectTab(progress.current)}>חזרה לשלב הנוכחי</button>}</div>
    <nav className="coordinator-stages" aria-label="שלבי תהליך השיבוץ">{progress.stages.map((stage) => <button key={stage.id} type="button" className={`coordinator-stage ${stage.state} ${tab === stage.id ? 'selected' : ''}`} aria-label={`שלב ${stage.number}: ${stage.label}`} title={stage.label} aria-current={tab === stage.id ? 'step' : undefined} onClick={() => void selectTab(stage.id)}><span className="coordinator-stage-number">{stage.number}</span><span className="coordinator-stage-label">{stage.label}</span><small>{stage.state === 'complete' ? stage.id === 'students' ? 'הבחירה נסגרה' : stage.id === 'proposed' ? 'פורסם' : 'אושר' : stage.state === 'current' ? 'כעת' : stage.state === 'available' ? 'זמין לעיון' : 'בהמשך'}</small></button>)}</nav>
    <details className="coordinator-stage-list"><summary>כל שלבי התהליך</summary><div>{progress.stages.map(stage => <button key={stage.id} type="button" aria-current={tab === stage.id ? 'step' : undefined} onClick={() => void selectTab(stage.id)}>{stage.number}. {stage.label}</button>)}</div></details>
    <div className="coordinator-stage-heading"><span>שלב {progress.stages.find((stage) => stage.id === tab)?.number}</span><h3>{progress.stages.find((stage) => stage.id === tab)?.label}</h3>{tab !== progress.current && <p>{progress.stages.find((stage) => stage.id === tab)?.state === 'upcoming' ? 'שלב זה ייפתח לעבודה בהמשך התהליך. אפשר לעיין בו כבר עכשיו.' : 'אפשר לעיין בתוצאות ולבצע פעולות הזמינות במצב המחזור הנוכחי.'}</p>}</div>
    {showTransition && action && <div className="workspace-actions coordinator-transition"><button type="button" className="primary-action" disabled={readOnly || pending || (cycle.status === 'choice_closed' && !allAiApproved) || (cycle.status === 'appeals' && progress.openAppeals > 0)} onClick={() => void confirmPerform(() => transitionCycle(cycle, action.to, action.reason), `הפעולה “${action.label}” בוצעה ונשמרה.`, `לבצע ${action.label}? מצב המחזור ישתנה עבור המשתמשים.`)}>{action.label}</button>{cycle.status === 'choice_closed' && !allAiApproved && <span>כדי לעבור לשיבוץ יש ליצור ולאשר את כל הערכות ההעדפות.</span>}{cycle.status === 'appeals' && progress.openAppeals > 0 && <span>כדי לסגור את המחזור יש לטפל בכל הערעורים הממתינים.</span>}{cycle.status === 'published' && <button type="button" className="secondary-action" onClick={() => void selectTab('delivery')}>שליחת תוצאות</button>}</div>}
    {tab === 'students' && <StudentRoster cycleId={cycleId} courseLabels={courseLabels} clusterLabels={clusterLabels} revision={cycleRevision} />}
    {tab === 'students' && cycle.status === 'choice_open' && <p className="coordinator-stage-note">סגרו את הבחירה רק לאחר שבדקתם מי הגיש. תלמידים שטרם הגישו לא יוכלו להשלים את הטופס לאחר הסגירה.</p>}
    <dl className="workspace-metrics"><div><dt>הערכות שאושרו</dt><dd>{workflow.aiEvaluations.filter((entry) => entry.approved).length}/{workflow.aiEvaluations.length}</dd></div><div><dt>ערעורים ממתינים</dt><dd>{progress.openAppeals}</dd></div></dl>
    {tab === 'evaluations' && workflow.aiBatchCreatedAt && <div className="evaluation-approval-panel"><strong>אישור הערכות</strong><p>{pendingEvaluations.length} ממתינות לאישור · {requiredReviewCount} דורשות בדיקה · {clearReviewCount} מתאימות לאישור מרוכז</p><div className="workspace-actions" role="group" aria-label="דרך אישור ההערכות"><button type="button" className={approvalMode === 'individual' ? 'primary-action' : 'secondary-action'} onClick={() => void selectApprovalMode('individual')}>כל מקרה בנפרד</button><button type="button" className={approvalMode === 'exceptions' ? 'primary-action' : 'secondary-action'} onClick={() => void selectApprovalMode('exceptions')}>בדיקת מקרים נדרשים</button><button type="button" className={approvalMode === 'all' ? 'primary-action' : 'secondary-action'} onClick={() => void selectApprovalMode('all')}>אישור מרוכז</button></div>{approvalMode === 'exceptions' && <><p>מקרים עם נימוק לא ברור, המלצה גבוהה או שלילית, התאמה ליותר מקורס אחד או הערכה ישנה מופיעים לבדיקה אישית. המלצה בינונית לקורס אחד והגשה ללא נימוק ניתנות לאישור יחד.</p>{clearReviewCount > 0 && <button type="button" className="secondary-action" disabled={readOnly || pending || Boolean(workflow.assignmentRun)} onClick={() => void confirmBulkApproval('clear_only', clearReviewCount)}>אישור {clearReviewCount} הערכות ברורות</button>}</>}{approvalMode === 'all' && <><p>אפשר לאשר יחד {bulkApprovalCount} הערכות. {negativeReviewCount} הערכות עם הסתייגות מפורשת יישארו לבדיקה ואישור פרטניים. אישורים קיימים לא ישתנו.</p><button type="button" className="primary-action" disabled={readOnly || pending || !bulkApprovalCount || Boolean(workflow.assignmentRun)} onClick={() => void confirmBulkApproval('all', bulkApprovalCount)}>אישור {bulkApprovalCount} הערכות</button></>}{workflow.assignmentRun && <p>כבר נוצרה הרצת שיבוץ; אי אפשר לאשר הערכות באופן מרוכז כעת.</p>}</div>}
    {tab === 'evaluations' && ['choice_closed', 'assignment'].includes(cycle.status) && <div className="workflow-section">
      <div className="section-heading compact"><div><h3>בדיקה ואישור לפני השיבוץ</h3></div>
        {!workflow.aiBatchCreatedAt && <button type="button" className="primary-action" disabled={readOnly || pending} onClick={() => void perform(() => generateAiEvaluations(cycleId), 'ההערכות נוצרו ומוכנות לבדיקה.')}>יצירת הערכות</button>}
        {workflow.aiBatchCreatedAt && !workflow.assignmentRun && <button type="button" className="secondary-action" disabled={readOnly || pending} onClick={() => void confirmPerform(() => generateAiEvaluations(cycleId, true), 'הערכות מעודכנות לפי קורס מוכנות לבדיקה. יש לאשר אותן מחדש לפני השיבוץ.', `להכין מחדש ${workflow.aiEvaluations.length} הערכות לפי כללי העדיפות המעודכנים? ההערכות והאישורים הקודמים יישמרו בארכיון, וכל ההערכות החדשות יחייבו בדיקה ואישור מחדש.`)}>{legacyEvaluationCount > 0 ? 'הכנת המלצות לפי קורסים' : 'הכנת הערכות מחדש'}</button>}
      </div>
      {workflow.assignmentRun && <p>ההערכות משמשות בהרצת שיבוץ קיימת. לא ניתן להכין אותן מחדש כעת.</p>}
      {pending && <p role="status">מכין הערכות. הפעולה עשויה להימשך כמה דקות.</p>}
      {approvalMode !== 'all' && <>
        <div className="evaluation-queue"><label>הצגת הערכות<select value={evaluationFilter} onChange={(event) => void selectEvaluationFilter(event.target.value)}><option value="pending">ממתינות לאישור</option><option value="all">כל ההערכות</option></select></label><strong aria-live="polite">{visibleEvaluations.length ? `${activeEvaluationIndex + 1} מתוך ${visibleEvaluations.length}` : 'אין הערכות להצגה'}</strong></div>
        {activeEvaluation && <EvaluationEditor key={`${activeEvaluation.id}:${workflow.version}`} evaluation={activeEvaluation} cycleId={cycleId} clusterLabel={clusterLabels[activeEvaluation.clusterId] ?? 'מקבץ'} onSaved={(updated) => { setWorkflow(updated); setActiveEvaluationId(evaluationFilter === 'all' ? activeEvaluation.id : visibleEvaluations[activeEvaluationIndex + 1]?.id ?? visibleEvaluations[activeEvaluationIndex - 1]?.id ?? null); setMessage('ההערכה נשמרה.') }} />}
        {visibleEvaluations.length > 1 && <div className="evaluation-pager" role="group" aria-label="מעבר בין הערכות"><button type="button" className="secondary-action" disabled={activeEvaluationIndex === 0} onClick={() => void selectEvaluation(visibleEvaluations[activeEvaluationIndex - 1].id)}>הקודמת</button><span>בדיקה {activeEvaluationIndex + 1} מתוך {visibleEvaluations.length}</span><button type="button" className="secondary-action" disabled={activeEvaluationIndex === visibleEvaluations.length - 1} onClick={() => void selectEvaluation(visibleEvaluations[activeEvaluationIndex + 1].id)}>הבאה</button></div>}
      </>}
    </div>}
    {tab === 'proposed' && cycle.status === 'assignment' && <ProposedAssignmentWorkspace cycleId={cycleId} workflow={workflow} courses={courses} catalog={catalogSnapshot} clusterLabels={clusterLabels} readOnly={readOnly} placeEditable pending={pending} rejectionReason={rejectionReason} onRejectionReason={setRejectionReason} onWorkflow={updated => { setWorkflow(updated); setCycleRevision(value => value + 1); setMessage('נתוני ההרצות עודכנו.') }} onApprove={() => void perform(() => approveAssignmentRun(cycleId), 'השיבוץ אושר ומוכן לפרסום.')} onPublish={() => void confirmPerform(() => publishAssignments(cycleId), 'השיבוץ פורסם במערכת. שליחת תוצאות במייל מתבצעת בנפרד.', `לפרסם את ההרצה הפעילה? היא כוללת ${activeRunExclusions} החרגות והתלמידים יוכלו לראות את התוצאה.`)} onReject={() => void confirmPerform(() => rejectAssignmentRun(cycleId, workflow.version, rejectionReason), 'ההצעה נדחתה. אפשר ליצור הצעה חדשה.', 'לדחות את הצעת השיבוץ?')} />}
    {tab === 'proposed' && cycle.status !== 'assignment' && (workflow.assignmentRun ? <ResultExplorer cycleId={cycleId} run={workflow.assignmentRun} courses={courses} catalog={catalogSnapshot} placeEditable={cycle.status !== 'closed'} /> : <p>השיבוץ המוצע יהיה זמין לאחר סגירת הבחירה ואישור ההעדפות.</p>)}
    {tab === 'actual' && (workflow.assignmentRun?.publishedAt ? <><ResultExplorer cycleId={cycleId} run={workflow.assignmentRun} courses={courses} catalog={catalogSnapshot} placeEditable={cycle.status !== 'closed'} /><StudentRoster cycleId={cycleId} courseLabels={courseLabels} clusterLabels={clusterLabels} revision={cycleRevision}/><ManualAssignmentChange cycleId={cycleId} workflow={workflow} courses={courses} clusterLabels={clusterLabels} editable={cycle.status !== 'closed'} onChanged={async()=>{await refresh();await onCycleChanged()}} onShowDelivery={()=>setSelectedStage('delivery')}/></> : <p>טרם פורסם שיבוץ בפועל. עברו לשיבוץ מוצע כדי לבדוק ולאשר אותו.</p>)}
    {tab === 'delivery' && <ResultDelivery cycleId={cycleId} published={Boolean(workflow.assignmentRun?.publishedAt)}/>}
    {tab === 'appeals' && ['published', 'appeals'].includes(cycle.status) && <AppealDeadlineControl key={cycle.version} cycle={cycle} readOnly={readOnly} onSaved={updated => { setCycle(updated); setMessage('מועד הערעורים עודכן.') }} />}
    {tab === 'appeals' && <div className="workflow-section"><h3>ערעורים ושינויים מוצעים</h3><div className="filter-bar"><label>חיפוש בתוכן הערעור<input value={appealQuery} onChange={(event) => setAppealQuery(event.target.value)} /></label><label>מצב<select value={appealStatus} onChange={(event) => setAppealStatus(event.target.value)}><option value="">כל הערעורים</option><option value="submitted">ממתינים להחלטה</option><option value="approved_pending_execution">ממתינים לביצוע</option><option value="executed">בוצעו</option><option value="rejected">נדחו</option></select></label></div>{!workflow.appeals.length && <p>לא התקבלו ערעורים במחזור זה.</p>}{workflow.appeals.filter((entry) => (!appealStatus || entry.status === appealStatus) && (!appealQuery || entry.reason.includes(appealQuery))).map((appeal) => <article className="appeal-card" key={appeal.id}><AppealDetails appeal={appeal} />{!appeal.analysis && <button type="button" className="secondary-action" disabled={readOnly || pending} onClick={() => void perform(() => analyzeAppeal(cycleId, appeal.id), 'ניתוח ההשפעה נשמר.')}>ניתוח השפעה</button>}{appeal.analysis && appeal.status === 'submitted' && <AppealDecisionControls appeal={appeal} readOnly={readOnly} pending={pending} onDecide={(outcome, reason) => void confirmPerform(() => decideAppeal(cycleId, appeal.id, outcome, reason), outcome === 'approved' ? 'הערעור אושר כהצעה. השיבוץ טרם השתנה.' : 'הערעור נדחה והתשובה נשמרה לתלמיד/ה במערכת.', 'לשמור את ההחלטה בערעור? התשובה האישית תופיע לתלמיד/ה.')} />}{appeal.status === 'approved_pending_execution' && appeal.analysis?.requiresMovingAnotherStudent && !appeal.capacityOverride && <button type="button" className="secondary-action" disabled={readOnly || pending} onClick={() => void perform(() => approveCapacityOverride(cycleId, appeal.id), 'אישור חריגת הקיבולת נשמר. רכז אחר יוכל לבצע את השינוי.')}>אישור חריגת קיבולת</button>}{appeal.status === 'approved_pending_execution' && (!appeal.analysis?.requiresMovingAnotherStudent || appeal.capacityOverride) && <button type="button" className="primary-action" disabled={readOnly || pending} onClick={() => void confirmPerform(() => executeAppealChange(cycleId, appeal.id, workflow.version), 'השינוי בוצע במערכת. אפשר לשלוח תוצאות מעודכנות בשלב שליחת התוצאות.', 'לבצע את השינוי המאושר בשיבוץ?')}>אישור מפורש וביצוע השינוי</button>}</article>)}</div>}
    {tab === 'appeals' && workflow.appeals.some((entry) => entry.status === 'executed') && <div className="workspace-actions"><button type="button" className="primary-action" onClick={() => setSelectedStage('delivery')}>שליחת עדכוני שינוי לתלמידים, למורים ולמזכירות</button></div>}
    <div className="workspace-actions"><button type="button" className="secondary-action" onClick={() => void refresh()}>רענון נתונים</button></div>
    <details className="audit-preview"><summary>פעולות אחרונות</summary>{audits.length ? <ol>{audits.slice(0, 5).map((event) => <li key={event.id}><strong>{auditLabels[event.action] ?? 'פעולה במערכת'}</strong><span>{new Date(event.occurredAt).toLocaleString('he-IL')}</span>{event.reason && <small>{event.reason}</small>}</li>)}</ol> : <p>עדיין לא נרשמו פעולות.</p>}</details>
  </section>
}
