import type { Course } from '../domain/catalog'
import type { AssignmentRun, WorkflowState } from '../domain/workflow'
import { runReadiness } from '../domain/runReadiness'
import { AssignmentScenarioPlanner } from './AssignmentScenarioPlanner'
import { ManualProposedAssignment } from './ManualProposedAssignment'
import { ResultExplorer } from './ResultExplorer'

function WarningSummary({ run, clusterLabels }: { run: AssignmentRun; clusterLabels: Record<string, string> }) {
  const byCluster = new Map<string, number>()
  for (const warning of run.warnings) {
    if (!warning.includes('לא נמצא מקום פנוי')) continue
    const id = [...Object.keys(clusterLabels)].find(clusterId => warning.includes(clusterId))
    const label = id ? clusterLabels[id] : 'מקבץ לא מזוהה'
    byCluster.set(label, (byCluster.get(label) ?? 0) + 1)
  }
  return <div className="run-warning-summary">{[...byCluster].map(([label, count]) => <p key={label}><strong>{count} ללא מקום ב־{label}</strong><span>בדקו מכסות, כיתות משתתפות או החרגות וצרו הרצה חדשה.</span></p>)}{run.warnings.length > 0 && <details><summary>פרטי אזהרות נוספים</summary><ul>{run.warnings.map((warning, index) => <li key={index}>{Object.entries(clusterLabels).reduce((text, [id, label]) => text.replaceAll(id, label), warning)}</li>)}</ul></details>}</div>
}

export function ProposedAssignmentWorkspace({ cycleId, workflow, courses, clusterLabels, readOnly, pending, rejectionReason, onRejectionReason, onWorkflow, onApprove, onPublish, onReject }: {
  cycleId: string; workflow: WorkflowState; courses: Course[]; clusterLabels: Record<string, string>; readOnly: boolean; pending: boolean; rejectionReason: string; onRejectionReason: (value: string) => void; onWorkflow: (value: WorkflowState) => void; onApprove: () => void; onPublish: () => void; onReject: () => void
}) {
  const run = workflow.assignmentRun
  const readiness = run ? runReadiness(run) : null
  return <div className="workflow-section proposed-workspace">
    {run ? <>
      <div className="proposed-overview"><div><span className="eyebrow">ההצעה הפעילה</span><h3>{run.label ?? 'הרצת שיבוץ'}</h3><p>{run.approvedAt ? 'אושרה וממתינה לפרסום' : 'ממתינה לבדיקה ולאישור'}</p></div><div className="proposed-metrics"><div><strong>{readiness?.assigned}/{readiness?.required}</strong><span>שיבוצים</span></div><div><strong>{readiness?.missing}</strong><span>ללא מקום</span></div><div><strong>{readiness?.firstChoices}/{readiness?.assigned}</strong><span>בחירה ראשונה</span></div><div><strong>{readiness?.excluded}</strong><span>החרגות</span></div></div></div>
      {readiness?.issues.length ? <div className="run-blocker" role="alert"><h4>יש להשלים את השיבוץ לפני אישור</h4>{readiness.issues.map(issue => <p key={issue}>{issue}</p>)}<WarningSummary run={run} clusterLabels={clusterLabels} /></div> : <p className="run-ready" role="status">כל המשתתפים שנכללו בהרצה שובצו. אפשר לעיין בתוצאות ולאשר.</p>}
      <ResultExplorer run={run} courses={courses} clusterLabels={clusterLabels} />
      {!run.approvedAt && <details className="proposed-tool"><summary>תיקון שיבוץ ידני בהצעה</summary><ManualProposedAssignment cycleId={cycleId} workflow={workflow} courses={courses} clusterLabels={clusterLabels} readOnly={readOnly} onWorkflow={onWorkflow} /></details>}
      <div className="workspace-actions proposed-decision">{!run.approvedAt ? <button type="button" className="primary-action" disabled={readOnly || pending || Boolean(readiness?.issues.length)} onClick={onApprove}>אישור ההרצה הפעילה</button> : <button type="button" className="primary-action" disabled={readOnly || pending || Boolean(readiness?.issues.length)} onClick={onPublish}>פרסום השיבוץ לתלמידים ולמורים</button>}{readiness?.issues.length ? <span>הפרסום ייפתח לאחר השלמת כל השיבוצים הכלולים.</span> : null}</div>
      {!run.publishedAt && <details className="proposed-tool"><summary>דחיית ההצעה</summary><label>סיבה לדחייה<textarea value={rejectionReason} onChange={event => onRejectionReason(event.target.value)} /></label><button type="button" className="danger-action" disabled={readOnly || pending || !rejectionReason.trim()} onClick={onReject}>דחיית ההצעה</button></details>}
    </> : <p>עדיין לא נוצר שיבוץ מוצע. בחרו מי משתתף וצרו הרצה.</p>}
    <details className="proposed-tool" open={!run}><summary>שינוי משתתפים ויצירת הרצה חדשה</summary><AssignmentScenarioPlanner cycleId={cycleId} workflow={workflow} clusterLabels={clusterLabels} readOnly={readOnly} onWorkflow={onWorkflow} /></details>
  </div>
}
