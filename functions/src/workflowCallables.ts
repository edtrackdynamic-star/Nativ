import { randomUUID } from 'node:crypto'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import type { ActorContext, CapabilityId } from '../../src/domain/access'
import type { AiPriority, AssignmentStudent } from '../../src/domain/assignmentEngine'
import { runDeterministicAssignment } from '../../src/domain/assignmentEngine'
import type { Course, CycleCatalogSnapshot } from '../../src/domain/catalog'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import type { AiEvaluation, AppealImpactAnalysis, AppealRecord, NotificationRecord, WorkflowState } from '../../src/domain/workflow'
import { redactDirectIdentifiers } from '../../src/integrations/ai/privacy'
import { catalogSnapshotDocumentPath, courseCatalogDocumentPath, cycleDocumentPath, organizationCollectionPath, workflowDocumentPath } from '../../server/firestore/paths'
import type { MailJob } from '../../server/mail/delivery'
import { callableOptions, coreFirestore, nativFirestore as firestore } from './firebase'
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

interface StudentAssignmentProfile { displayLabel: string; classId?: string; classLabel?: string }

async function studentAssignmentProfiles(organizationId: string, studentIds: string[]): Promise<Map<string, StudentAssignmentProfile>> {
  const uniqueIds = [...new Set(studentIds)]
  if (!uniqueIds.length) return new Map()
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return new Map(await Promise.all(uniqueIds.map(async (uid) => {
      try {
        const user = await getAuth().getUser(uid)
        return [uid, { displayLabel: user.displayName || user.email || 'תלמיד', classId: String(user.customClaims?.classId ?? '') || undefined, classLabel: String(user.customClaims?.classLabel ?? '') || undefined }] as const
      } catch { return [uid, { displayLabel: 'תלמיד', classId: undefined, classLabel: undefined }] as const }
    })))
  }
  const [members, students] = await Promise.all([
    coreFirestore.getAll(...uniqueIds.map((uid) => coreFirestore.doc(`organizations/${organizationId}/members/${uid}`))),
    coreFirestore.getAll(...uniqueIds.map((uid) => coreFirestore.doc(`organizations/${organizationId}/students/${uid}`))),
  ])
  const classIds = [...new Set(uniqueIds.map((uid, index) => String(students[index].data()?.classId ?? members[index].data()?.classIds?.[0] ?? '')).filter(Boolean))]
  const classSnapshots = classIds.length ? await coreFirestore.getAll(...classIds.map((classId) => coreFirestore.doc(`organizations/${organizationId}/classes/${classId}`))) : []
  const classLabels = new Map(classSnapshots.map((snapshot) => [snapshot.id, String(snapshot.data()?.name ?? '')]))
  return new Map(uniqueIds.map((uid, index) => {
    const classId = String(students[index].data()?.classId ?? members[index].data()?.classIds?.[0] ?? '')
    return [uid, { displayLabel: String(members[index].data()?.fullName ?? 'תלמיד'), classId: classId || undefined, classLabel: classLabels.get(classId) || String(students[index].data()?.className ?? '') || undefined }]
  }))
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

async function notificationStatuses(organizationId: string, notifications: NotificationRecord[]): Promise<NotificationRecord[]> {
  const emails = notifications.filter((entry) => entry.channel === 'email' && entry.deliveryEventId)
  const paths = [...new Set(emails.flatMap((entry) => [`organizations/${organizationId}/mailStatuses/${entry.id}`, `organizations/${organizationId}/mailEvents/${entry.deliveryEventId}`]))]
  const values = new Map<string, string>()
  for (let offset = 0; offset < paths.length; offset += 100) {
    const snapshots = await firestore.getAll(...paths.slice(offset, offset + 100).map((path) => firestore.doc(path)))
    snapshots.forEach((snapshot) => values.set(snapshot.ref.path, String(snapshot.data()?.status ?? 'queued')))
  }
  return notifications.map((entry) => {
    if (entry.channel !== 'email' || !entry.deliveryEventId) return entry
    const status = values.get(`organizations/${organizationId}/mailStatuses/${entry.id}`)
    const eventStatus = values.get(`organizations/${organizationId}/mailEvents/${entry.deliveryEventId}`)
    const resolved = status === 'sent' || status === 'failed' || status === 'delivery_unknown' ? status : eventStatus === 'failed' ? 'failed' : 'queued'
    return { ...entry, status: resolved }
  })
}

export const getWorkflow = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const requestedView = typeof data.view === 'string' ? data.view : undefined
  const [snapshot, cycleSnapshot] = await Promise.all([
    workflowRef(actor, cycleId).get(),
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(),
  ])
  const workflow = snapshot.exists ? snapshot.data() as WorkflowState : emptyWorkflow(actor, cycleId, new Date().toISOString())
  if (requestedView === 'coordinator' || (!requestedView && actor.capabilities.includes('nativ.assignment.manage'))) {
    requireCapability(actor, 'nativ.assignment.manage')
    return { ...workflow, notifications: await notificationStatuses(actor.organizationId, workflow.notifications) }
  }
  if (requestedView === 'appeal_reviewer' || (!requestedView && actor.roles.includes('appeal_reviewer'))) {
    if (!actor.roles.includes('appeal_reviewer')) throw new HttpsError('permission-denied', 'אין הרשאה לצפייה בערעורים')
    return { ...workflow, history: [], aiEvaluations: [], assignmentRun: undefined, notifications: [], appeals: workflow.appeals }
  }
  if (requestedView === 'secretary' || (!requestedView && actor.roles.includes('secretary'))) {
    if (!actor.roles.includes('secretary')) throw new HttpsError('permission-denied', 'אין הרשאת מזכירות')
    return { ...workflow, history: [], aiEvaluations: [], assignmentRun: undefined, appeals: [], notifications: await notificationStatuses(actor.organizationId, workflow.notifications.filter((entry) => entry.audience === 'secretary')) }
  }
  if (requestedView === 'student' || (!requestedView && actor.roles.includes('student'))) {
    if (!actor.roles.includes('student')) throw new HttpsError('permission-denied', 'אין הרשאת תלמיד')
    const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
    const isPublished = Boolean(workflow.assignmentRun?.publishedAt) && Boolean(cycle && ['published', 'appeals', 'closed'].includes(cycle.status))
    const assignmentRun = isPublished && workflow.assignmentRun ? { ...workflow.assignmentRun, executedBy: '', approvedBy: undefined, enrollmentByCourse: {}, warnings: [], tieBreaks: [], assignments: workflow.assignmentRun.assignments.filter((entry) => entry.studentId === actor.uid) } : undefined
    return { ...workflow, history: [], aiEvaluations: [], assignmentRun, appeals: workflow.appeals.filter((entry) => entry.studentId === actor.uid), notifications: await notificationStatuses(actor.organizationId, workflow.notifications.filter((entry) => entry.recipientRef === actor.uid)) }
  }
  requireCapability(actor, 'nativ.assignment.view')
  return { ...workflow, history: [], aiEvaluations: [], assignmentRun: undefined, appeals: [], notifications: [] }
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
  if (process.env.FUNCTIONS_EMULATOR !== 'true') throw new HttpsError('failed-precondition', 'הערכת AI טרם הופעלה במערכת זו')
  const submissions = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission))
  if (!submissions.length) throw new HttpsError('failed-precondition', 'אין הגשות סופיות להערכה')
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
  const [cycleSnapshot, workflowSnapshot, catalogSnapshot, cycleCatalogSnapshot, submissionsSnapshot] = await Promise.all([
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(), workflowRef(actor, cycleId).get(),
    firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).get(),
  ])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  const workflow = workflowSnapshot.data() as WorkflowState | undefined
  if (cycle?.status !== 'assignment') throw new HttpsError('failed-precondition', 'המחזור חייב להיות במצב שיבוץ')
  if (!workflow || !workflow.aiEvaluations.length || workflow.aiEvaluations.some((evaluation) => !evaluation.approved)) throw new HttpsError('failed-precondition', 'יש לאשר את כל פלטי ה-AI לפני השיבוץ')
  const courses = (catalogSnapshot.data()?.courses ?? []) as Course[]
  const catalog = cycleCatalogSnapshot.data() as CycleCatalogSnapshot | undefined
  const submissions = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission))
  const profiles = await studentAssignmentProfiles(actor.organizationId, submissions.map((submission) => submission.studentId))
  const students: AssignmentStudent[] = submissions.map((submission) => { const profile = profiles.get(submission.studentId); return { studentId: submission.studentId, displayLabel: profile?.displayLabel ?? 'תלמיד', classId: profile?.classId, classLabel: profile?.classLabel, submission, approvedAiByCluster: Object.fromEntries(workflow.aiEvaluations.filter((evaluation) => evaluation.studentId === submission.studentId && evaluation.approved).map((evaluation) => [evaluation.clusterId, evaluation.approved!.priority])) } })
  const calculated = runDeterministicAssignment({ cycleId, clusterIds: [...new Set(courses.map((course) => course.clusterId))], courses, students, balanceByClassClusterIds: catalog?.clusters.filter((cluster) => cluster.balanceByClass).map((cluster) => cluster.clusterId) })
  const result = { ...calculated, assignments: calculated.assignments.map((assignment) => ({ ...assignment, studentLabel: profiles.get(assignment.studentId)?.displayLabel ?? 'תלמיד', studentClassLabel: profiles.get(assignment.studentId)?.classLabel })) }
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const [currentSnapshot, currentCycleSnapshot] = await transaction.getAll(reference, firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)))
    const current = currentSnapshot.data() as WorkflowState | undefined
    const currentCycle = currentCycleSnapshot.data() as AssignmentCycle | undefined
    if (!current || current.version !== workflow.version) throw new HttpsError('aborted', 'המידע השתנה; יש לרענן ולהריץ שוב')
    if (currentCycle?.status !== 'assignment') throw new HttpsError('failed-precondition', 'המחזור אינו במצב שיבוץ')
    if (current.assignmentRun) throw new HttpsError('already-exists', 'כבר קיימת הרצת שיבוץ; יש לפתוח הרצה חדשה באופן מפורש')
    const next: WorkflowState = { ...current, assignmentRun: { id: randomUUID(), executedAt: now, executedBy: actor.uid, algorithmVersion: 'legacy-compatible-1.0.0', seed: 42, ...result }, version: current.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(current, actor, 'assignment.run.executed', 'הרצת שיבוץ', now) }
    transaction.set(reference, next)
    return next
  })
})

export const approveAssignmentRun = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.manage')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const [snapshot, cycleSnapshot] = await transaction.getAll(reference, firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)))
    const workflow = snapshot.data() as WorkflowState | undefined
    const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
    if (cycle?.status !== 'assignment' || !workflow?.assignmentRun || workflow.assignmentRun.publishedAt) throw new HttpsError('failed-precondition', 'אין תוצאת שיבוץ פעילה לאישור')
    if (workflow.assignmentRun.approvedAt) throw new HttpsError('already-exists', 'גרסת השיבוץ כבר אושרה')
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
    const [cycleSnapshot, workflowSnapshot, catalogSnapshot] = await transaction.getAll(cycleReference, workflowReference, firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)))
    const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
    const workflow = workflowSnapshot.data() as WorkflowState | undefined
    if (cycle?.status !== 'assignment' || !workflow?.assignmentRun?.approvedAt) throw new HttpsError('failed-precondition', 'יש לאשר גרסת שיבוץ לפני הפרסום')
    const catalog = catalogSnapshot.data() as CycleCatalogSnapshot | undefined
    const eventId = `publication-${workflow.assignmentRun.id}`
    const jobs: MailJob[] = []
    const notifications: NotificationRecord[] = workflow.assignmentRun.assignments.flatMap((assignment) => {
      const cluster = catalog?.clusters.find((entry) => entry.clusterId === assignment.clusterId)
      const course = cluster?.courses.find((entry) => entry.courseId === assignment.courseId)
      if (!cluster || !course) throw new HttpsError('failed-precondition', 'חסרים פרטי קורס; יש להשלים את הקטלוג לפני הפרסום')
      const notificationId = randomUUID()
      jobs.push({ notificationId, audience: 'student', studentId: assignment.studentId, clusterLabel: cluster.label, afterCourseLabel: course.label, occurredAt: now })
      const common = { audience: 'student' as const, recipientRef: assignment.studentId, subject: 'השיבוץ שלך פורסם', body: `השיבוץ במקבץ ${cluster.label}: ${course.label}`, createdAt: now }
      return [{ ...common, id: randomUUID(), channel: 'in_app' as const, status: 'available' as const }, { ...common, id: notificationId, channel: 'email' as const, status: 'queued' as const, deliveryEventId: eventId }]
    })
    const nextWorkflow: WorkflowState = { ...workflow, assignmentRun: { ...workflow.assignmentRun, publishedAt: now }, notifications: [...workflow.notifications, ...notifications], version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'assignment.published', 'פרסום נפרד של גרסת השיבוץ המאושרת', now) }
    const nextCycle = { ...cycle, status: 'published' as const, publishedAt: now, version: cycle.version + 1, updatedAt: now, updatedBy: actor.uid }
    transaction.set(workflowReference, nextWorkflow)
    transaction.set(cycleReference, nextCycle)
    transaction.create(firestore.doc(`organizations/${actor.organizationId}/mailEvents/${eventId}`), { organizationId: actor.organizationId, cycleId, jobs, status: 'queued', attempts: 0, createdAt: now, createdBy: actor.uid })
    return nextWorkflow
  })
})

function analyze(current: WorkflowState, appeal: AppealRecord, courses: Course[], now: string): AppealImpactAnalysis {
  const before = current.assignmentRun?.assignments.find((entry) => entry.studentId === appeal.studentId && entry.clusterId === appeal.clusterId)
  const requested = courses.find((course) => course.id === appeal.requestedCourseId)
  if (!before || !requested) throw new HttpsError('failed-precondition', 'לא ניתן לנתח את השינוי המבוקש')
  if (requested.clusterId !== appeal.clusterId) throw new HttpsError('failed-precondition', 'הקורס המבוקש אינו שייך למקבץ הערעור')
  if (before.courseId === requested.id) throw new HttpsError('failed-precondition', 'הקורס המבוקש כבר משובץ לתלמיד במקבץ זה')
  const counts = current.assignmentRun?.enrollmentByCourse ?? {}
  const afterCount = (counts[requested.id] ?? 0) + 1
  const createsDuplicateCourse = current.assignmentRun!.assignments.some((entry) => entry.studentId === appeal.studentId && entry.clusterId !== appeal.clusterId && courses.find((course) => course.id === entry.courseId)?.logicalCourseId === requested.logicalCourseId)
  const constraintViolations = [
    ...(afterCount > requested.capacity.maximum ? ['חריגה מהקיבולת המרבית; נדרש אישור נוסף'] : []),
    ...(createsDuplicateCourse && requested.repeatPolicy === 'prohibited' ? ['מדיניות הקורס אינה מאפשרת חזרה על הקורס'] : []),
  ]
  return { analyzedAt: now, baseWorkflowVersion: current.version + 1, beforeCourseId: before.courseId, afterCourseId: requested.id, capacityBefore: { current: counts[before.courseId] ?? 0, maximum: courses.find((course) => course.id === before.courseId)?.capacity.maximum ?? 0 }, capacityAfter: { current: afterCount, maximum: requested.capacity.maximum }, createsDuplicateCourse, constraintViolations, requiresMovingAnotherStudent: afterCount > requested.capacity.maximum, affectedOutputs: ['רשימת תלמידים בקורס הנוכחי', 'רשימת תלמידים בקורס החדש', 'דוח השיבוץ של התלמיד', 'דוח שינויים למזכירות'] }
}

export const submitAppeal = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  if (!actor.roles.includes('student')) throw new HttpsError('permission-denied', 'רק תלמיד יכול להגיש ערעור אישי')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const clusterId = requiredString(data, 'clusterId')
  const requestedCourseId = requiredString(data, 'requestedCourseId')
  const reason = requiredString(data, 'reason')
  const [cycleSnapshot, submissionsSnapshot, coursesSnapshot] = await Promise.all([firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(), firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).where('studentId', '==', actor.uid).get(), firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get()])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  if (cycle?.status !== 'appeals') throw new HttpsError('failed-precondition', 'חלון הערעורים אינו פתוח')
  const requestedCourse = ((coursesSnapshot.data()?.courses ?? []) as Course[]).find((course) => course.id === requestedCourseId)
  if (!requestedCourse?.published || requestedCourse.clusterId !== clusterId) throw new HttpsError('failed-precondition', 'הקורס המבוקש אינו זמין במקבץ שנבחר')
  const original = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission))[0]
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState
    if (!workflow.assignmentRun?.publishedAt || !workflow.assignmentRun.assignments.some((entry) => entry.studentId === actor.uid && entry.clusterId === clusterId)) throw new HttpsError('failed-precondition', 'לא נמצא שיבוץ שפורסם במקבץ זה')
    if (workflow.appeals.some((appeal) => appeal.studentId === actor.uid && appeal.clusterId === clusterId && !['rejected', 'executed'].includes(appeal.status))) throw new HttpsError('already-exists', 'כבר קיים ערעור פעיל במקבץ זה')
    const appeal: AppealRecord = { id: randomUUID(), studentId: actor.uid, clusterId, requestedCourseId, reason, createdAt: now, status: 'submitted', originalPreference: original?.preferences.find((entry) => entry.clusterId === clusterId), originalSubmission: original ? { preferences: original.preferences, catalogSnapshot: original.catalogSnapshot, submittedAt: original.submittedAt, submissionVersion: original.submissionVersion } : undefined, sourceSubmissionId: original?.id, sourceSubmissionVersion: original?.submissionVersion, aiEvaluationId: workflow.aiEvaluations.find((entry) => entry.studentId === actor.uid && entry.clusterId === clusterId)?.id }
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

export const recommendAppeal = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.appeal.review')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const appealId = requiredString(data, 'appealId')
  const outcome = requiredString(data, 'outcome') as 'approve' | 'reject' | 'more_information'
  if (!['approve', 'reject', 'more_information'].includes(outcome)) throw new HttpsError('invalid-argument', 'ההמלצה אינה תקינה')
  const reason = requiredString(data, 'reason')
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState
    const appeal = workflow.appeals.find((entry) => entry.id === appealId)
    if (appeal?.status !== 'submitted') throw new HttpsError('failed-precondition', 'ניתן להמליץ רק בערעור שממתין להחלטה')
    const nextVersion = workflow.version + 1
    const next = { ...workflow, appeals: workflow.appeals.map((entry) => entry.id === appealId ? { ...entry, analysis: entry.analysis ? { ...entry.analysis, baseWorkflowVersion: nextVersion } : undefined, recommendation: { outcome, reason, recommendedAt: now, recommendedBy: actor.uid } } : entry), version: nextVersion, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'appeal.recommended', reason, now) }
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
    if (appeal?.status !== 'submitted' || !appeal.analysis) throw new HttpsError('failed-precondition', 'נדרש ערעור פתוח עם ניתוח השפעה לפני החלטה')
    if (appeal.analysis.baseWorkflowVersion !== workflow.version) throw new HttpsError('aborted', 'המידע השתנה; יש לבצע ניתוח השפעה מחדש')
    const next = { ...workflow, appeals: workflow.appeals.map((entry) => entry.id === appealId ? { ...entry, status: outcome === 'approved' ? 'approved_pending_execution' as const : 'rejected' as const, decision: { outcome, reason, decidedAt: now, decidedBy: actor.uid } } : entry), version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, `appeal.${outcome}`, reason, now) }
    transaction.set(reference, next)
    return next
  })
})

export const approveCapacityOverride = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.capacity.override.approve')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const appealId = requiredString(data, 'appealId')
  const reason = requiredString(data, 'reason')
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState
    const appeal = workflow.appeals.find((entry) => entry.id === appealId)
    if (appeal?.status !== 'approved_pending_execution' || !appeal.analysis?.requiresMovingAnotherStudent) throw new HttpsError('failed-precondition', 'הערעור אינו ממתין לאישור חריגת קיבולת')
    const nextVersion = workflow.version + 1
    const next = { ...workflow, appeals: workflow.appeals.map((entry) => entry.id === appealId ? { ...entry, analysis: { ...entry.analysis!, baseWorkflowVersion: nextVersion }, capacityOverride: { approvedAt: now, approvedBy: actor.uid, reason, baseWorkflowVersion: nextVersion } } : entry), version: nextVersion, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'appeal.capacity_override.approved', reason, now) }
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
  const [coursesSnapshot, catalogSnapshot] = await Promise.all([firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(), firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get()])
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
    const nonCapacityViolations = fresh.constraintViolations.filter((violation) => !violation.includes('קיבולת המרבית'))
    if (nonCapacityViolations.length) throw new HttpsError('failed-precondition', 'השינוי מפר אילוץ שאינו ניתן לאישור במסלול זה', fresh)
    if (fresh.requiresMovingAnotherStudent) {
      if (!appeal.capacityOverride || appeal.capacityOverride.baseWorkflowVersion !== workflow.version) throw new HttpsError('failed-precondition', 'נדרש אישור חריגת קיבולת עדכני מרכז אחר')
      if (appeal.capacityOverride.approvedBy === actor.uid) throw new HttpsError('failed-precondition', 'מבצע השינוי חייב להיות אדם אחר ממאשר חריגת הקיבולת')
    }
    const previous = workflow.assignmentRun.assignments.find((entry) => entry.studentId === appeal.studentId && entry.clusterId === appeal.clusterId)!
    const assignments = workflow.assignmentRun.assignments.map((entry) => entry === previous ? { ...entry, courseId: appeal.requestedCourseId, source: 'hard_constraint' as const, explanation: `שינוי לאחר ערעור ${appeal.id}` } : entry)
    const counts = { ...workflow.assignmentRun.enrollmentByCourse, [previous.courseId]: workflow.assignmentRun.enrollmentByCourse[previous.courseId] - 1, [appeal.requestedCourseId]: (workflow.assignmentRun.enrollmentByCourse[appeal.requestedCourseId] ?? 0) + 1 }
    const cluster = (catalogSnapshot.data() as CycleCatalogSnapshot | undefined)?.clusters.find((entry) => entry.clusterId === appeal.clusterId)
    const beforeCourse = courses.find((entry) => entry.id === previous.courseId)
    const afterCourse = courses.find((entry) => entry.id === appeal.requestedCourseId)
    if (!cluster || !beforeCourse || !afterCourse) throw new HttpsError('failed-precondition', 'חסרים פרטי קורס; יש להשלים את הקטלוג לפני ביצוע השינוי')
    const eventId = `appeal-${appeal.id}`
    const secretaryMailId = randomUUID(); const studentMailId = randomUUID()
    const notifications: NotificationRecord[] = [
      { id: randomUUID(), audience: 'secretary', recipientRef: 'school-secretary', channel: 'in_app', subject: 'שינוי שיבוץ לאחר ערעור', body: `${appeal.studentId}: ${beforeCourse.label} ← ${afterCourse.label}`, status: 'available', createdAt: now },
      { id: secretaryMailId, audience: 'secretary', recipientRef: 'school-secretary', channel: 'email', subject: 'שינוי שיבוץ לאחר ערעור', body: `${appeal.studentId}: ${beforeCourse.label} ← ${afterCourse.label}`, status: 'queued', deliveryEventId: eventId, createdAt: now },
      { id: randomUUID(), audience: 'student', recipientRef: appeal.studentId, channel: 'in_app', subject: 'הערעור בוצע', body: `השיבוץ עודכן ל-${afterCourse.label}`, status: 'available', createdAt: now },
      { id: studentMailId, audience: 'student', recipientRef: appeal.studentId, channel: 'email', subject: 'השיבוץ שלך עודכן', body: `השיבוץ עודכן ל-${afterCourse.label}`, status: 'queued', deliveryEventId: eventId, createdAt: now },
    ]
    const commonJob = { studentId: appeal.studentId, clusterLabel: cluster.label, afterCourseLabel: afterCourse.label, occurredAt: now }
    const jobs: MailJob[] = [{ ...commonJob, notificationId: secretaryMailId, audience: 'secretary', beforeCourseLabel: beforeCourse.label }, { ...commonJob, notificationId: studentMailId, audience: 'student' }]
    const next: WorkflowState = { ...workflow, assignmentRun: { ...workflow.assignmentRun, assignments, enrollmentByCourse: counts }, appeals: workflow.appeals.map((entry) => entry.id === appealId ? { ...entry, analysis: fresh, status: 'executed', executedAt: now, executedBy: actor.uid } : entry), notifications: [...workflow.notifications, ...notifications], version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'appeal.change.executed', `השיבוץ שונה מ-${previous.courseId} ל-${appeal.requestedCourseId} לאחר בדיקה חוזרת`, now) }
    transaction.set(reference, next)
    transaction.create(firestore.doc(`organizations/${actor.organizationId}/mailEvents/${eventId}`), { organizationId: actor.organizationId, cycleId, jobs, status: 'queued', attempts: 0, createdAt: now, createdBy: actor.uid })
    return next
  })
})
