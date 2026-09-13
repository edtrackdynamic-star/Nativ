import type { AssignmentCycle } from '../domain/cycle'
import type { WorkflowState } from '../domain/workflow'

export const coordinatorStageIds = ['students', 'evaluations', 'proposed', 'actual', 'appeals', 'delivery'] as const
export type CoordinatorStageId = (typeof coordinatorStageIds)[number]
export type CoordinatorStageState = 'complete' | 'current' | 'available' | 'upcoming'

export const coordinatorStageLabels: Record<CoordinatorStageId, string> = {
  students: 'בחירות התלמידים', evaluations: 'בדיקת העדפות', proposed: 'שיבוץ מוצע',
  actual: 'פרסום השיבוץ', appeals: 'ערעורים ושינויים', delivery: 'שליחת תוצאות',
}

export function coordinatorStageProgress(cycle: AssignmentCycle, workflow: WorkflowState, now: number) {
  const published = Boolean(workflow.assignmentRun?.publishedAt)
  const openAppeals = workflow.appeals.filter((appeal) => appeal.status === 'submitted' || appeal.status === 'approved_pending_execution').length
  const approved = workflow.aiEvaluations.length > 0 && workflow.aiEvaluations.every((entry) => entry.approved)
  const current: CoordinatorStageId = cycle.status === 'draft' || cycle.status === 'choice_open' ? 'students'
    : cycle.status === 'choice_closed' ? 'evaluations'
    : cycle.status === 'assignment' ? 'proposed'
    : cycle.status === 'published' ? 'actual'
    : cycle.status === 'appeals' && openAppeals ? 'appeals' : 'delivery'
  const deadlinePassed = cycle.status === 'choice_open' && Boolean(cycle.choiceDeadlineEnabled && cycle.choiceClosesAt && new Date(cycle.choiceClosesAt!).getTime() <= now)
  const next: Record<CoordinatorStageId, string> = {
    students: cycle.status === 'draft' ? 'הכינו את הטופס ושלחו אותו לתלמידים בלוח הגדרות וטופס.'
      : deadlinePassed ? 'מועד ההגשה חלף. אפשר להאריך אותו בהגדרות הטופס או לסגור את הבחירה כאן.'
      : 'בדקו מי הגיש ומי עדיין ממתין. כשהבחירות הסתיימו, סגרו את שלב הבחירה.',
    evaluations: !workflow.aiBatchCreatedAt ? 'צרו המלצות להעדפות התלמידים, בדקו אותן ואשרו לפני השיבוץ.'
      : approved ? 'כל ההעדפות אושרו. אפשר לעבור לשיבוץ.' : 'בדקו את ההמלצות הממתינות ואשרו אותן לפני המעבר לשיבוץ.',
    proposed: !workflow.assignmentRun ? 'צרו הרצת שיבוץ ובדקו את התוצאות והאזהרות.'
      : !workflow.assignmentRun.approvedAt ? 'בדקו את ההרצה הפעילה ואשרו אותה או דחו אותה עם סיבה.'
      : 'ההרצה אושרה. פרסמו אותה כדי שהתלמידים יוכלו לראות את השיבוץ.',
    actual: 'השיבוץ פורסם. בדקו את התוצאות ושלחו אותן לנמענים המתאימים; אפשר לפתוח חלון ערעורים.',
    appeals: `${openAppeals} ערעורים ממתינים לטיפול. בדקו כל בקשה ובצעו שינוי רק לאחר אישור מפורש.`,
    delivery: cycle.status === 'closed' ? 'המחזור נסגר. אפשר לעיין בתוצאות ובמצב השליחה.'
      : cycle.status === 'appeals' ? 'כל הערעורים טופלו. בדקו עדכונים שטרם נשלחו, ואז סגרו את המחזור.'
      : 'בדקו את הנמענים ושלחו תוצאות מלאות או עדכונים על שינויים שבוצעו.',
  }
  const currentIndex = coordinatorStageIds.indexOf(current)
  const stages = coordinatorStageIds.map((id, index) => ({
    id, number: index + 1, label: coordinatorStageLabels[id],
    state: (index === currentIndex ? 'current'
      : id === 'evaluations' && approved || id === 'proposed' && published || id === 'students' && !['draft', 'choice_open'].includes(cycle.status) ? 'complete'
      : index < currentIndex || id === 'delivery' && published ? 'available' : 'upcoming') as CoordinatorStageState,
  }))
  return { current, next: next[current], stages, openAppeals, approved }
}
