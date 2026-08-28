import { randomUUID } from 'node:crypto'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { ActorContext, CapabilityId } from '../../src/domain/access'
import type { AiPriority, AssignmentStudent } from '../../src/domain/assignmentEngine'
import { runDeterministicAssignment } from '../../src/domain/assignmentEngine'
import type { Course } from '../../src/domain/catalog'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import type { AiEvaluation, AppealImpactAnalysis, AppealRecord, NotificationRecord, WorkflowState } from '../../src/domain/workflow'
import { redactDirectIdentifiers } from '../../src/integrations/ai/privacy'
import { courseCatalogDocumentPath, cycleDocumentPath, organizationCollectionPath, workflowDocumentPath } from '../../server/firestore/paths'
import { callableOptions, nativFirestore as firestore } from './firebase'
import { actorFromRequest, inputRecord, requiredInteger, requiredString } from './request'

function requireCapability(actor: ActorContext, capability: CapabilityId) {
  if (!actor.capabilities.includes(capability)) throw new HttpsError('permission-denied', 'אין הרשאה לפעולה זו')
}

function workflowRef(actor: ActorContext, cycleId: string) {
  return firestore.doc(workflowDocumentPath(actor.organizationId, cycleId))
}

function emptyWorkflow(actor: ActorContext, cycleId: string, now: string): WorkflowState {
  return { id: cycleId, organizationId: actor.organizationId, cycleId, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, aiEvaluations: [], appeals: [], notifications: [], history: [] }
}

function history(current: WorkflowState, actor: ActorContext, action: string, reason: string, now: string) {
  return [...(current.history ?? []), { id: randomUUID(), action, actorId: actor.uid, occurredAt: now, reason, workflowVersion: current.version + 1 }]
}

function mockEvaluation(rationale: string | undefined): { priority: AiPriority; summary: string } {
  const normalized = rationale?.trim() ?? ''
  if (!normalized) return { priority: 'neutral', summary: 'לא נמסר נימוק; בהתאם למדיניות אין הפחתת עדיפות.' }
  if (/(פרויקט|ניסיון|בניתי|למדתי|מתמיד|חשוב|חלום|עתיד)/u.test(normalized)) return { priority: 'high', summary: 'הנימוק מציג חיבור אישי ממוקד או ניסיון קודם.' }
  return { priority: 'medium', summary: 'נמסר נימוק רלוונטי לבחירה.' }
}

function latestSubmitted(submissions: PreferenceSubmission[]): PreferenceSubmission[] {
  const latest = new Map<string, PreferenceSubmission>()
  submissions.filter((entry) => entry.status === 'submitted').forEach((entry) => {
    const current = latest.get(entry.studentId)
    if (!current || entry.submissionVersion > current.submissionVersion) latest.set(entry.studentId, entry)
  })
  return [...latest.values()]
}

export const getWorkflow = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const snapshot = await workflowRef(actor, cycleId).get()
  const workflow = snapshot.exists ? snapshot.data() as WorkflowState : emptyWorkflow(actor, cycleId, new Date().toISOString())
  if (actor.roles.includes('student')) {
    return { ...workflow, aiEvaluations: [], assignmentRun: workflow.assignmentRun ? { ...workflow.assignmentRun, assignments: workflow.assignmentRun.assignments.filter((entry) => entry.studentId === actor.uid), tieBreaks: [] } : undefined, appeals: workflow.appeals.filter((entry) => entry.studentId === actor.uid), notifications: workflow.notifications.filter((entry) => entry.recipientRef === actor.uid) }
  }
  if (actor.roles.includes('secretary')) {
    return { ...workflow, aiEvaluations: [], assignmentRun: undefined, appeals: [], notifications: workflow.notifications.filter((entry) => entry.audience === 'secretary') }
  }
  requireCapability(actor, 'nativ.assignment.view')
  return workflow
})

export const generateAiEvaluations = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.ai.review')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const [cycleSnapshot, submissionsSnapshot] = await Promise.all([
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).get(),
  ])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  if (!cycle || !['choice_closed', 'assignment'].includes(cycle.status)) throw new HttpsError('failed-precondition', 'יש לסגור את הבחירה לפני הערכת AI')
  const submissions = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission))
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const current = snapshot.exists ? snapshot.data() as WorkflowState : emptyWorkflow(actor, cycleId, now)
    if (current.aiBatchCreatedAt) throw new HttpsError('already-exists', 'הערכת AI כבר נוצרה עבור גרסאות הגשה אלה')
    const evaluations: AiEvaluation[] = submissions.flatMap((submission) => submission.preferences.map((preference) => {
      const sanitizedRationale = redactDirectIdentifiers(preference.rationale ?? '').sanitizedText.trim()
      const result = mockEvaluation(sanitizedRationale)
      return { id: randomUUID(), anonymousStudentRef: `anon-${randomUUID()}`, studentId: submission.studentId, clusterId: preference.clusterId, sourceSubmissionId: submission.id, sourceSubmissionVersion: submission.submissionVersion, input: { rankings: preference.rankings, ...(sanitizedRationale ? { rationale: sanitizedRationale } : {}) }, raw: { ...result, model: 'local-mock-v1' as const, evaluatedAt: now } }
    }))
    const nextVersion = current.version + (snapshot.exists ? 1 : 0)
    const next = { ...current, version: nextVersion, aiBatchCreatedAt: now, aiEvaluations: evaluations, updatedAt: now, updatedBy: actor.uid, history: [...(current.history ?? []), { id: randomUUID(), action: 'ai.batch.generated', actorId: actor.uid, occurredAt: now, reason: 'יצירת הערכה אנונימית חד-פעמית לגרסאות ההגשה הסופיות', workflowVersion: nextVersion }] }
    transaction.set(reference, next)
    return next
  })
})

export const approveAiEvaluation = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.ai.review')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const evaluationId = requiredString(data, 'evaluationId')
  const priority = requiredString(data, 'priority') as AiPriority
  if (!['high', 'medium', 'neutral'].includes(priority)) throw new HttpsError('invalid-argument', 'עדיפות AI אינה תקינה')
  const summary = requiredString(data, 'summary')
  const reason = requiredString(data, 'reason')
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) throw new HttpsError('not-found', 'לא נמצאה הערכת AI')
    const current = snapshot.data() as WorkflowState
    const evaluations = current.aiEvaluations.map((evaluation) => evaluation.id === evaluationId ? { ...evaluation, approved: { priority, summary, reason, approvedAt: now, approvedBy: actor.uid } } : evaluation)
    if (!evaluations.some((evaluation) => evaluation.id === evaluationId)) throw new HttpsError('not-found', 'ההערכה לא נמצאה')
    const next = { ...current, aiEvaluations: evaluations, version: current.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(current, actor, 'ai.evaluation.approved', reason, now) }
    transaction.set(reference, next)
    return next
  })
})

export const runAssignment = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.manage')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const [cycleSnapshot, workflowSnapshot, catalogSnapshot, submissionsSnapshot] = await Promise.all([
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(), workflowRef(actor, cycleId).get(),
    firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).get(),
  ])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  const workflow = workflowSnapshot.data() as WorkflowState | undefined
  if (cycle?.status !== 'assignment') throw new HttpsError('failed-precondition', 'המחזור חייב להיות במצב שיבוץ')
  if (!workflow || !workflow.aiEvaluations.length || workflow.aiEvaluations.some((evaluation) => !evaluation.approved)) throw new HttpsError('failed-precondition', 'יש לאשר את כל פלטי ה-AI לפני השיבוץ')
  const courses = (catalogSnapshot.data()?.courses ?? []) as Course[]
  const submissions = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission))
  const students: AssignmentStudent[] = submissions.map((submission) => ({ studentId: submission.studentId, displayLabel: submission.studentId, submission, approvedAiByCluster: Object.fromEntries(workflow.aiEvaluations.filter((evaluation) => evaluation.studentId === submission.studentId && evaluation.approved).map((evaluation) => [evaluation.clusterId, evaluation.approved!.priority])) }))
  const result = runDeterministicAssignment({ cycleId, clusterIds: [...new Set(courses.map((course) => course.clusterId))], courses, students })
  const now = new Date().toISOString()
  const next: WorkflowState = { ...workflow, assignmentRun: { id: randomUUID(), executedAt: now, executedBy: actor.uid, algorithmVersion: 'legacy-compatible-1.0.0', seed: 42, ...result }, version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'assignment.run.executed', 'הרצת מנוע שיבוץ דטרמיניסטי על פלטי AI מאושרים', now) }
  await workflowRef(actor, cycleId).set(next)
  return next
})

export const approveAssignmentRun = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.manage')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState | undefined
    if (!workflow?.assignmentRun) throw new HttpsError('failed-precondition', 'אין תוצאת שיבוץ לאישור')
    const next: WorkflowState = { ...workflow, assignmentRun: { ...workflow.assignmentRun, approvedAt: now, approvedBy: actor.uid }, version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'assignment.run.approved', 'אישור מפורש של גרסת השיבוץ לפני פרסום', now) }
    transaction.set(reference, next)
    return next
  })
})

export const publishAssignments = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.publish')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const cycleReference = firestore.doc(cycleDocumentPath(actor.organizationId, cycleId))
    const workflowReference = workflowRef(actor, cycleId)
    const [cycleSnapshot, workflowSnapshot] = await transaction.getAll(cycleReference, workflowReference)
    const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
    const workflow = workflowSnapshot.data() as WorkflowState | undefined
    if (cycle?.status !== 'assignment' || !workflow?.assignmentRun?.approvedAt) throw new HttpsError('failed-precondition', 'יש לאשר גרסת שיבוץ לפני הפרסום')
    const notifications: NotificationRecord[] = workflow.assignmentRun.assignments.flatMap((assignment) => ['in_app', 'email'].map((channel) => ({ id: randomUUID(), audience: 'student' as const, recipientRef: assignment.studentId, channel: channel as 'in_app' | 'email', subject: 'השיבוץ שלך פורסם', body: `השיבוץ במקבץ ${assignment.clusterId}: ${assignment.courseId}`, status: 'queued_mock' as const, createdAt: now })))
    const nextWorkflow: WorkflowState = { ...workflow, assignmentRun: { ...workflow.assignmentRun, publishedAt: now }, notifications: [...workflow.notifications, ...notifications], version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'assignment.published', 'פרסום נפרד של גרסת השיבוץ המאושרת', now) }
    const nextCycle = { ...cycle, status: 'published' as const, publishedAt: now, version: cycle.version + 1, updatedAt: now, updatedBy: actor.uid }
    transaction.set(workflowReference, nextWorkflow)
    transaction.set(cycleReference, nextCycle)
    return nextWorkflow
  })
})

function analyze(current: WorkflowState, appeal: AppealRecord, courses: Course[], now: string): AppealImpactAnalysis {
  const before = current.assignmentRun?.assignments.find((entry) => entry.studentId === appeal.studentId && entry.clusterId === appeal.clusterId)
  const requested = courses.find((course) => course.id === appeal.requestedCourseId)
  if (!before || !requested) throw new HttpsError('failed-precondition', 'לא ניתן לנתח את השינוי המבוקש')
  const counts = current.assignmentRun?.enrollmentByCourse ?? {}
  const afterCount = (counts[requested.id] ?? 0) + 1
  return { analyzedAt: now, baseWorkflowVersion: current.version + 1, beforeCourseId: before.courseId, afterCourseId: requested.id, capacityBefore: { current: counts[before.courseId] ?? 0, maximum: courses.find((course) => course.id === before.courseId)?.capacity.maximum ?? 0 }, capacityAfter: { current: afterCount, maximum: requested.capacity.maximum }, createsDuplicateCourse: false, constraintViolations: afterCount > requested.capacity.maximum ? ['חריגה מהקיבולת המרבית; נדרש אישור נוסף'] : [], requiresMovingAnotherStudent: afterCount > requested.capacity.maximum, affectedOutputs: ['רשימת תלמידים לקורס הנוכחי', 'רשימת תלמידים לקורס החדש', 'דוח שיבוץ תלמיד', 'דוח שינויים למזכירות'] }
}

export const submitAppeal = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  if (!actor.roles.includes('student')) throw new HttpsError('permission-denied', 'רק תלמיד יכול להגיש ערעור אישי')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const clusterId = requiredString(data, 'clusterId')
  const requestedCourseId = requiredString(data, 'requestedCourseId')
  const reason = requiredString(data, 'reason')
  const [cycleSnapshot, submissionsSnapshot] = await Promise.all([firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(), firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).where('studentId', '==', actor.uid).get()])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  if (cycle?.status !== 'appeals') throw new HttpsError('failed-precondition', 'חלון הערעורים אינו פתוח')
  const original = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission))[0]
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState
    if (workflow.appeals.some((appeal) => appeal.studentId === actor.uid && appeal.clusterId === clusterId && !['rejected', 'executed'].includes(appeal.status))) throw new HttpsError('already-exists', 'כבר קיים ערעור פעיל במקבץ זה')
    const appeal: AppealRecord = { id: randomUUID(), studentId: actor.uid, clusterId, requestedCourseId, reason, createdAt: now, status: 'submitted', originalPreference: original?.preferences.find((entry) => entry.clusterId === clusterId), originalSubmission: original ? { preferences: original.preferences, submittedAt: original.submittedAt } : undefined, sourceSubmissionId: original?.id, sourceSubmissionVersion: original?.submissionVersion, aiEvaluationId: workflow.aiEvaluations.find((entry) => entry.studentId === actor.uid && entry.clusterId === clusterId)?.id }
    const next = { ...workflow, appeals: [...workflow.appeals, appeal], version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'appeal.submitted', reason, now) }
    transaction.set(reference, next)
    return appeal
  })
})

export const analyzeAppeal = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.appeal.review')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const appealId = requiredString(data, 'appealId')
  const coursesSnapshot = await firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get()
  const courses = (coursesSnapshot.data()?.courses ?? []) as Course[]
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState
    const appeal = workflow.appeals.find((entry) => entry.id === appealId)
    if (!appeal) throw new HttpsError('not-found', 'הערעור לא נמצא')
    const analysis = analyze(workflow, appeal, courses, now)
    const next = { ...workflow, appeals: workflow.appeals.map((entry) => entry.id === appealId ? { ...entry, analysis } : entry), version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'appeal.impact_analyzed', 'ניתוח לפני החלטה: קיבולת, כפילות, אילוצים, העברה ודוחות מושפעים', now) }
    transaction.set(reference, next)
    return next
  })
})

export const decideAppeal = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.appeal.decide')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const appealId = requiredString(data, 'appealId')
  const outcome = requiredString(data, 'outcome') as 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(outcome)) throw new HttpsError('invalid-argument', 'החלטה אינה תקינה')
  const reason = requiredString(data, 'reason')
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState
    const appeal = workflow.appeals.find((entry) => entry.id === appealId)
    if (!appeal?.analysis) throw new HttpsError('failed-precondition', 'נדרש ניתוח השפעה לפני החלטה')
    const next = { ...workflow, appeals: workflow.appeals.map((entry) => entry.id === appealId ? { ...entry, status: outcome === 'approved' ? 'approved_pending_execution' as const : 'rejected' as const, decision: { outcome, reason, decidedAt: now, decidedBy: actor.uid } } : entry), version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, `appeal.${outcome}`, reason, now) }
    transaction.set(reference, next)
    return next
  })
})

export const executeAppealChange = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.manage')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const appealId = requiredString(data, 'appealId')
  const expectedWorkflowVersion = requiredInteger(data, 'expectedWorkflowVersion')
  const coursesSnapshot = await firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get()
  const courses = (coursesSnapshot.data()?.courses ?? []) as Course[]
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState
    if (workflow.version !== expectedWorkflowVersion) throw new HttpsError('aborted', 'המידע השתנה; יש לבצע ניתוח השפעה מחדש')
    const appeal = workflow.appeals.find((entry) => entry.id === appealId)
    if (appeal?.status !== 'approved_pending_execution' || !workflow.assignmentRun) throw new HttpsError('failed-precondition', 'השינוי אינו מאושר לביצוע')
    const fresh = analyze(workflow, appeal, courses, now)
    if (fresh.constraintViolations.length) throw new HttpsError('failed-precondition', 'השינוי מפר אילוצים או קיבולת ודורש מסלול אישור נוסף', fresh)
    const previous = workflow.assignmentRun.assignments.find((entry) => entry.studentId === appeal.studentId && entry.clusterId === appeal.clusterId)!
    const assignments = workflow.assignmentRun.assignments.map((entry) => entry === previous ? { ...entry, courseId: appeal.requestedCourseId, source: 'hard_constraint' as const, explanation: `שינוי לאחר ערעור ${appeal.id}` } : entry)
    const counts = { ...workflow.assignmentRun.enrollmentByCourse, [previous.courseId]: workflow.assignmentRun.enrollmentByCourse[previous.courseId] - 1, [appeal.requestedCourseId]: (workflow.assignmentRun.enrollmentByCourse[appeal.requestedCourseId] ?? 0) + 1 }
    const notifications: NotificationRecord[] = [
      { id: randomUUID(), audience: 'secretary', recipientRef: 'school-secretary', channel: 'in_app', subject: 'שינוי שיבוץ לאחר ערעור', body: `${appeal.studentId}: ${previous.courseId} ← ${appeal.requestedCourseId}`, status: 'queued_mock', createdAt: now },
      { id: randomUUID(), audience: 'secretary', recipientRef: 'school-secretary', channel: 'email', subject: 'שינוי שיבוץ לאחר ערעור', body: `${appeal.studentId}: ${previous.courseId} ← ${appeal.requestedCourseId}`, status: 'queued_mock', createdAt: now },
      { id: randomUUID(), audience: 'student', recipientRef: appeal.studentId, channel: 'in_app', subject: 'הערעור בוצע', body: `השיבוץ עודכן ל-${appeal.requestedCourseId}`, status: 'queued_mock', createdAt: now },
    ]
    const next: WorkflowState = { ...workflow, assignmentRun: { ...workflow.assignmentRun, assignments, enrollmentByCourse: counts }, appeals: workflow.appeals.map((entry) => entry.id === appealId ? { ...entry, analysis: fresh, status: 'executed', executedAt: now, executedBy: actor.uid } : entry), notifications: [...workflow.notifications, ...notifications], version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'appeal.change.executed', `השיבוץ שונה מ-${previous.courseId} ל-${appeal.requestedCourseId} לאחר בדיקה חוזרת`, now) }
    transaction.set(reference, next)
    return next
  })
})
