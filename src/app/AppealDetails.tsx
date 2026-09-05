import type { AppealRecord } from '../domain/workflow'

function courseLabel(appeal: AppealRecord, courseId: string | undefined) {
  if (!courseId) return 'לא ידוע'
  return appeal.originalSubmission?.catalogSnapshot?.flatMap((cluster) => cluster.courses).find((course) => course.courseId === courseId)?.label ?? courseId
}

function clusterLabel(appeal: AppealRecord, clusterId: string) {
  return appeal.originalSubmission?.catalogSnapshot?.find((cluster) => cluster.clusterId === clusterId)?.label ?? clusterId
}

export function AppealDetails({ appeal }: { appeal: AppealRecord }) {
  const original = appeal.originalPreference
  return <>
    <div className="appeal-summary"><strong>{clusterLabel(appeal, appeal.clusterId)}</strong><p>מבוקש: {courseLabel(appeal, appeal.requestedCourseId)}</p><p>סיבת הערעור: {appeal.reason}</p></div>
    <div className="ranking-summary"><h4>הבחירות המקוריות במקבץ</h4>{original?.rankings.length ? <ol>{[...original.rankings].sort((left, right) => left.rank - right.rank).map((ranking) => <li key={ranking.courseId}>{courseLabel(appeal, ranking.courseId)}</li>)}</ol> : <p>לא נמצאו דירוגים.</p>}<p><strong>נימוק:</strong> {original?.rationale?.trim() || 'לא נכתב נימוק.'}</p></div>
    <details><summary>צפייה בטופס הבחירה המקורי</summary><div className="original-form">{appeal.originalSubmission?.preferences.map((preference) => <section key={preference.clusterId}><h4>{clusterLabel(appeal, preference.clusterId)}</h4><ol>{[...preference.rankings].sort((left, right) => left.rank - right.rank).map((ranking) => <li key={ranking.courseId}>{courseLabel(appeal, ranking.courseId)}</li>)}</ol><p><strong>נימוק:</strong> {preference.rationale?.trim() || 'לא נכתב נימוק.'}</p></section>)}</div>{appeal.originalSubmission?.submittedAt && <small>הוגש בתאריך {new Date(appeal.originalSubmission.submittedAt).toLocaleString('he-IL')} · גרסה {appeal.originalSubmission.submissionVersion ?? appeal.sourceSubmissionVersion}</small>}</details>
    {appeal.recommendation && <p className="team-recommendation"><strong>המלצת הצוות:</strong> {appeal.recommendation.reason}</p>}
    {appeal.analysis && <div className="impact-grid"><span>לפני: {courseLabel(appeal, appeal.analysis.beforeCourseId)}</span><span>אחרי: {courseLabel(appeal, appeal.analysis.afterCourseId)}</span><span>קיבולת לפני: {appeal.analysis.capacityBefore.current}/{appeal.analysis.capacityBefore.maximum}</span><span>קיבולת אחרי: {appeal.analysis.capacityAfter.current}/{appeal.analysis.capacityAfter.maximum}</span><span>{appeal.analysis.createsDuplicateCourse ? 'נוצרת חזרה על קורס' : 'לא נוצרת חזרה על קורס'}</span><span>{appeal.analysis.requiresMovingAnotherStudent ? 'נדרשת העברת תלמיד נוסף' : 'לא נדרשת העברה נוספת'}</span><span>{appeal.analysis.constraintViolations.join(', ') || 'אין הפרת אילוצים'}</span><span>{appeal.analysis.affectedOutputs.join(' · ')}</span></div>}
  </>
}
