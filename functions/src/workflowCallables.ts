import { includesClass } from '../../src/domain/classEligibility'
import { runReadiness } from '../../src/domain/runReadiness'
import { needsIndividualAiReview } from '../../src/domain/aiReview'
import { defineSecret } from 'firebase-functions/params'
import { evaluateWithGemini, GEMINI_MODEL, hasExplicitRejection, sanitizeRationale } from '../../server/gemini/evaluation'
import type { EvaluationCourse } from '../../server/gemini/evaluation'
import { createHash, randomUUID } from 'node:crypto'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import type { ActorContext, CapabilityId } from '../../src/domain/access'
import type { AiPriority, AssignmentStudent } from '../../src/domain/assignmentEngine'
import { runDeterministicAssignment } from '../../src/domain/assignmentEngine'
import type { Course, CycleCatalogSnapshot } from '../../src/domain/catalog'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import type { AiEvaluation, AppealImpactAnalysis, AppealRecord, AssignmentParticipationScope, AssignmentRun, NotificationRecord, WorkflowState } from '../../src/domain/workflow'
import { assignmentRunDocumentPath, assignmentRunsCollectionPath, catalogSnapshotDocumentPath, courseCatalogDocumentPath, cycleDocumentPath, organizationCollectionPath, workflowDocumentPath } from '../../server/firestore/paths'
import { callableOptions, coreFirestore, nativFirestore as firestore } from './firebase'
import { actorFromRequest, inputRecord, requiredInteger, requiredString } from './request'
import type { MailJob } from '../../server/mail/delivery'
import type { AssignmentChangeRecord } from '../../src/domain/assignmentChange'
import { operationalError } from './operationalIncidents'

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

export async function studentAssignmentProfiles(organizationId: string, studentIds: string[]): Promise<Map<string, StudentAssignmentProfile>> {
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

function coursesForEvaluation(submission: PreferenceSubmission, preference: PreferenceSubmission['preferences'][number]): { clusterLabel: string; courses: EvaluationCourse[] } {
  const snapshot = submission.catalogSnapshot.find((cluster) => cluster.clusterId === preference.clusterId)
  if (!snapshot) throw new HttpsError('failed-precondition', 'חסרים פרטי מקבץ בהגשת תלמיד. יש לבדוק את ההגשה לפני הערכה.')
  const ranks = new Map(preference.rankings.map((ranking) => [ranking.courseId, ranking.rank]))
  if (preference.rankings.some((ranking) => !snapshot.courses.some((course) => course.courseId === ranking.courseId))) {
    throw new HttpsError('failed-precondition', 'חסר שם קורס בהגשת תלמיד. יש לבדוק את ההגשה לפני הערכה.')
  }
  return { clusterLabel: snapshot.label.slice(0, 200), courses: snapshot.courses.map((course) => ({ courseId: course.courseId, label: course.label.slice(0, 200), ...(course.description ? { description: course.description.slice(0, 500) } : {}), rank: ranks.get(course.courseId) ?? null })) }
}

function latestSubmitted(submissions: PreferenceSubmission[]): PreferenceSubmission[] {
  const latest = new Map<string, PreferenceSubmission>()
  submissions.filter((entry) => entry.status === 'submitted').forEach((entry) => {
    const current = latest.get(entry.studentId)
    if (!current || entry.submissionVersion > current.submissionVersion) latest.set(entry.studentId, entry)
  })
  return [...latest.values()]
}

function participationScope(value: unknown, clusterIds: Set<string>, studentIds: Set<string>, classIds: Set<string>): AssignmentParticipationScope {
  const data = value === undefined ? {} : inputRecord(value)
  const parseMap = (input: unknown, allowedIds: Set<string>, label: string) => {
    if (input === undefined) return {}
    const source = inputRecord(input)
    const result: Record<string, string[]> = {}
    for (const [clusterId, ids] of Object.entries(source)) {
      if (!clusterIds.has(clusterId) || !Array.isArray(ids) || ids.some(id=>typeof id!=='string' || !allowedIds.has(id))) throw new HttpsError('invalid-argument', `החרגת ${label} אינה תקינה`)
      result[clusterId] = [...new Set(ids as string[])]
    }
    return result
  }
  return {
    excludedClassIdsByCluster: parseMap(data.excludedClassIdsByCluster, classIds, 'כיתות'),
    excludedStudentIdsByCluster: parseMap(data.excludedStudentIdsByCluster, studentIds, 'תלמידים'),
  }
}

function excludedFromCluster(student: AssignmentStudent, clusterId: string, scope: AssignmentParticipationScope): boolean {
  return Boolean(scope.excludedStudentIdsByCluster[clusterId]?.includes(student.studentId)
    || (student.classId && scope.excludedClassIdsByCluster[clusterId]?.includes(student.classId)))
}

function assignmentRunFromStorage(value:unknown):AssignmentRun {
  const run={...(value as AssignmentRun&{organizationId?:string;cycleId?:string})}
  delete run.organizationId;delete run.cycleId
  return run
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
    if(assignmentRun){delete assignmentRun.label;delete assignmentRun.scope;delete assignmentRun.includedStudentClusterCount;delete assignmentRun.excludedStudentClusterCount;delete assignmentRun.parentRunId;delete assignmentRun.manualChanges}
    return { ...workflow, history: [], aiEvaluations: [], assignmentRun, appeals: workflow.appeals.filter((entry) => entry.studentId === actor.uid), notifications: await notificationStatuses(actor.organizationId, workflow.notifications.filter((entry) => entry.recipientRef === actor.uid)) }
  }
  requireCapability(actor, 'nativ.assignment.view')
  return { ...workflow, history: [], aiEvaluations: [], assignmentRun: undefined, appeals: [], notifications: [] }
})

const geminiSecret = defineSecret('GEMINI_API_KEY')
export const generateAiEvaluations = onCall({ ...callableOptions, secrets: [geminiSecret], timeoutSeconds: 540 }, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.ai.review')
  const input = inputRecord(request.data)
  const cycleId = requiredString(input, 'cycleId')
  const refresh = input.refresh === true
  const [cycleSnapshot, submissionsSnapshot] = await Promise.all([
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).get(),
  ])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  if (!cycle || !['choice_closed', 'assignment'].includes(cycle.status)) throw new HttpsError('failed-precondition', 'יש לסגור את הבחירה לפני הערכת ההעדפות')
  const submissions = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission)).sort((a, b) => a.id.localeCompare(b.id))
  if (!submissions.length) throw new HttpsError('failed-precondition', 'אין הגשות סופיות להערכה')
  const signature = createHash('sha256').update(JSON.stringify(submissions.map((entry) => [entry.id, entry.version, entry.submissionVersion]))).digest('hex')
  const sourceBatch = refresh ? (await workflowRef(actor, cycleId).get()).data() as WorkflowState | undefined : undefined
  if (refresh && !sourceBatch?.aiBatchCreatedAt) throw new HttpsError('failed-precondition', 'אין הערכות קיימות להכנה מחדש. יש ליצור תחילה הערכות.')
  if (refresh && sourceBatch?.assignmentRun) throw new HttpsError('failed-precondition', 'כבר נוצר שיבוץ. יש לבדוק את ההרצה לפני שינוי ההערכות.')
  const refreshKey = sourceBatch?.aiBatchCreatedAt ? `-rubric-v3-${createHash('sha256').update(`${sourceBatch.aiBatchCreatedAt}:${sourceBatch.version}`).digest('hex').slice(0, 16)}` : ''
  const jobRef = firestore.doc(`organizations/${actor.organizationId}/aiGenerationJobs/${encodeURIComponent(cycleId)}${refresh ? refreshKey : ''}`)
  const token = randomUUID()
  let reviewedWorkflowVersion: number | undefined
  const cached = await firestore.runTransaction(async (transaction) => {
    const [job, workflow] = await Promise.all([transaction.get(jobRef), transaction.get(workflowRef(actor, cycleId))])
    const current = workflow.data() as WorkflowState | undefined
    if (refresh) {
      if (!current?.aiBatchCreatedAt || current.aiBatchCreatedAt !== sourceBatch?.aiBatchCreatedAt) throw new HttpsError('aborted', 'ההערכות השתנו מאז תחילת ההכנה. יש לרענן לפני ניסיון נוסף.')
      if (current.assignmentRun) throw new HttpsError('failed-precondition', 'כבר נוצר שיבוץ. יש לבדוק את ההרצה לפני שינוי ההערכות.')
      reviewedWorkflowVersion = current.version
    } else if (current?.aiBatchCreatedAt) return null
    if (Number(job.data()?.leaseUntil ?? 0) > Date.now()) throw new HttpsError('already-exists', 'הערכת ההעדפות כבר מתבצעת. יש לרענן בעוד כמה דקות.')
    if (job.exists && job.data()?.signature !== signature) throw new HttpsError('failed-precondition', 'גרסאות ההגשה השתנו. יש לבדוק את המחזור לפני המשך ההערכה.')
    transaction.set(jobRef, { signature, token, leaseUntil: Date.now() + 600000 }, { merge: true })
    return (job.data()?.evaluations ?? []) as AiEvaluation[]
  })
  if (cached === null) return (await workflowRef(actor, cycleId).get()).data() as WorkflowState
  try {
    const profiles = await studentAssignmentProfiles(actor.organizationId, submissions.map((entry) => entry.studentId))
    const identities = [...profiles.values()].flatMap((entry) => [entry.displayLabel, entry.classLabel ?? ''])
    const evaluations: AiEvaluation[] = [...cached]
    const pending = submissions.flatMap((submission) => submission.preferences.map((preference) => ({ submission, preference })))
      .filter(({ submission, preference }) => !evaluations.some((entry) => entry.sourceSubmissionId === submission.id && entry.clusterId === preference.clusterId))
    const deadline = Date.now() + 420000
    for (let offset = 0; offset < pending.length; offset += 12) {
      if (Date.now() > deadline) throw new Error('ההתקדמות נשמרה. יש ללחוץ שוב כדי להשלים את ההערכות שנותרו.')
      const batch = pending.slice(offset, offset + 12).map(({ submission, preference }) => ({ submission, preference, id: randomUUID(), rationale: sanitizeRationale(preference.rationale ?? '', identities), ...coursesForEvaluation(submission, preference) }))
      const nonempty = batch.filter((entry) => entry.rationale)
      const results = process.env.FUNCTIONS_EMULATOR === 'true' ? nonempty.map((entry) => ({ id: entry.id, summary: mockEvaluation(entry.rationale).summary, courses: entry.courses.map((course) => ({ courseId: course.courseId, priority: 'neutral' as const, reason: 'פלט בדיקה מקומי; יש לבדוק ידנית את הקשר לקורס.' })) }))
        : nonempty.length ? await evaluateWithGemini(geminiSecret.value(), nonempty.map((entry) => ({ id: entry.id, rationale: entry.rationale, clusterLabel: entry.clusterLabel, courses: entry.courses }))) : []
      const now = new Date().toISOString()
      evaluations.push(...batch.map(({ submission, preference, id, rationale, clusterLabel, courses }): AiEvaluation => {
        const result = results.find((entry) => entry.id === id) ?? { summary: 'לא נמסר נימוק; ההערכה ניטרלית.', courses: courses.map((course) => ({ courseId: course.courseId, priority: 'neutral' as const, reason: 'לא נמסר נימוק לקורס זה.' })) }
        const coursePriorities = result.courses.map((course) => ({ ...course, reason: sanitizeRationale(course.reason, identities) || 'יש לבדוק את הקשר בין ההסבר לקורס.' }))
        const priority = coursePriorities.some((course) => course.priority === 'high') ? 'high' : coursePriorities.some((course) => course.priority === 'medium') ? 'medium' : coursePriorities.some((course) => course.priority === 'neutral') ? 'neutral' : 'negative'
        return { id, anonymousStudentRef: 'anon-' + id, studentId: submission.studentId, clusterId: preference.clusterId,
          sourceSubmissionId: submission.id, sourceSubmissionVersion: submission.submissionVersion,
          input: { rankings: preference.rankings, clusterLabel, courses, ...(rationale ? { rationale } : {}) },
          raw: { priority, summary: sanitizeRationale(result.summary, identities) || 'יש לבדוק את ההסבר לפני אישור ההערכה.', coursePriorities, model: process.env.FUNCTIONS_EMULATOR === 'true' ? 'local-mock-v2' : rationale ? GEMINI_MODEL : 'neutral-no-rationale', evaluatedAt: now } }
      }))
      await firestore.runTransaction(async (transaction) => {
        const job = await transaction.get(jobRef)
        if (job.data()?.token !== token) throw new HttpsError('aborted', 'ההערכה עודכנה ממקום אחר. יש לרענן.')
        transaction.update(jobRef, { evaluations })
      })
    }
    return await firestore.runTransaction(async (transaction) => {
      const reference = workflowRef(actor, cycleId)
      const [snapshot, currentCycle, job] = await Promise.all([transaction.get(reference), transaction.get(cycleSnapshot.ref), transaction.get(jobRef)])
      if (currentCycle.data()?.version !== cycle.version || job.data()?.token !== token) throw new HttpsError('aborted', 'המחזור השתנה. יש לרענן לפני המשך העבודה.')
      const now = new Date().toISOString()
      const current = snapshot.exists ? snapshot.data() as WorkflowState : emptyWorkflow(actor, cycleId, now)
      if (refresh && current.version !== reviewedWorkflowVersion) throw new HttpsError('aborted', 'הערכות ההעדפות השתנו בזמן ההכנה. יש לרענן לפני ניסיון נוסף.')
      if (refresh && (!current.aiBatchCreatedAt || current.aiBatchCreatedAt !== sourceBatch?.aiBatchCreatedAt)) throw new HttpsError('aborted', 'ההערכות השתנו בזמן ההכנה. יש לרענן לפני ניסיון נוסף.')
      if (!refresh && current.aiBatchCreatedAt) return current
      if (refresh && current.assignmentRun) throw new HttpsError('failed-precondition', 'כבר נוצר שיבוץ. יש לבדוק את ההרצה לפני שינוי ההערכות.')
      if (refresh) {
        const archiveRef = firestore.collection(`organizations/${actor.organizationId}/aiEvaluationArchives`).doc()
        transaction.create(archiveRef, { cycleId, archivedAt: now, archivedBy: actor.uid, previousBatchCreatedAt: current.aiBatchCreatedAt, evaluations: current.aiEvaluations })
      }
      const next = { ...current, version: current.version + 1, aiBatchCreatedAt: now, aiEvaluations: evaluations, updatedAt: now, updatedBy: actor.uid, history: history(current, actor, refresh ? 'ai.batch.refreshed' : 'ai.batch.generated', refresh ? 'ההערכות הישנות נשמרו בארכיון ונוצרו המלצות מעודכנות לפי קורסים' : 'הערכות ההעדפות הוכנו לבדיקת הרכז', now) }
      transaction.set(reference, next)
      transaction.update(jobRef, { leaseUntil: 0, completedAt: now })
      return next
    })
  } catch (error) {
    await firestore.runTransaction(async (transaction) => {
      const job = await transaction.get(jobRef)
      if (job.data()?.token === token) transaction.update(jobRef, { leaseUntil: 0 })
    })
    if (error instanceof HttpsError) throw error
    throw new HttpsError('unavailable', error instanceof Error && /[א-ת]/u.test(error.message) ? error.message : 'ההערכה לא הושלמה. ההתקדמות נשמרה וניתן לנסות שוב.')
  }
})

export const approveAiEvaluation = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.ai.review')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const evaluationId = requiredString(data, 'evaluationId')
  const priority = requiredString(data, 'priority') as AiPriority
  if (!['high', 'medium', 'neutral', 'negative'].includes(priority)) throw new HttpsError('invalid-argument', 'עדיפות AI אינה תקינה')
  const summary = requiredString(data, 'summary')
  const reason = requiredString(data, 'reason')
  const submittedCoursePriorities = data.coursePriorities
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) throw new HttpsError('not-found', 'לא נמצאה הערכת AI')
    const current = snapshot.data() as WorkflowState
    const target = current.aiEvaluations.find((evaluation) => evaluation.id === evaluationId)
    if (!target) throw new HttpsError('not-found', 'ההערכה לא נמצאה')
    let coursePriorities: { courseId: string; priority: AiPriority }[] | undefined
    if (target.raw.coursePriorities) {
      const expected = new Set(target.raw.coursePriorities.map((entry) => entry.courseId))
      if (!Array.isArray(submittedCoursePriorities) || submittedCoursePriorities.length !== expected.size) throw new HttpsError('invalid-argument', 'יש לבדוק את העדיפות לכל קורס במקבץ')
      const seen = new Set<string>()
      coursePriorities = submittedCoursePriorities.map((value) => {
        const entry = inputRecord(value)
        const courseId = requiredString(entry, 'courseId')
        const coursePriority = requiredString(entry, 'priority') as AiPriority
        if (!expected.has(courseId) || seen.has(courseId) || !['high', 'medium', 'neutral', 'negative'].includes(coursePriority)) throw new HttpsError('invalid-argument', 'העדיפות לאחד הקורסים אינה תקינה')
        if (target.input.courses?.find((course) => course.courseId === courseId)?.rank === null && coursePriority !== 'neutral') throw new HttpsError('invalid-argument', 'לא ניתן לתת עדיפות לקורס שלא דורג')
        if (coursePriority === 'negative' && !hasExplicitRejection(target.input.rationale ?? '')) throw new HttpsError('invalid-argument', 'אפשר לסמן עדיפות שלילית רק כשהתלמיד כתב הסתייגות מפורשת מהקורס. בדקו את הנימוק או בחרו ניטרלית.')
        seen.add(courseId)
        return { courseId, priority: coursePriority }
      })
      const derivedPriority = coursePriorities.some((entry) => entry.priority === 'high') ? 'high' : coursePriorities.some((entry) => entry.priority === 'medium') ? 'medium' : coursePriorities.some((entry) => entry.priority === 'neutral') ? 'neutral' : 'negative'
      if (priority !== derivedPriority) throw new HttpsError('invalid-argument', 'סיכום העדיפות אינו תואם את העדיפויות לקורסים')
    }
    const evaluations = current.aiEvaluations.map((evaluation) => evaluation.id === evaluationId ? { ...evaluation, approved: { priority, summary, reason, approvedAt: now, approvedBy: actor.uid, ...(coursePriorities ? { coursePriorities } : {}) } } : evaluation)
    const next = { ...current, aiEvaluations: evaluations, version: current.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(current, actor, 'ai.evaluation.approved', reason, now) }
    transaction.set(reference, next)
    return next
  })
})

export const runAssignment = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.manage')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim().slice(0, 120) : 'הרצת שיבוץ'
  const [cycleSnapshot, workflowSnapshot, catalogSnapshot, cycleCatalogSnapshot, submissionsSnapshot] = await Promise.all([
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(), workflowRef(actor, cycleId).get(),
    firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).get(),
  ])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  const workflow = workflowSnapshot.data() as WorkflowState | undefined
  if (cycle?.status !== 'assignment') throw new HttpsError('failed-precondition', 'המחזור חייב להיות במצב שיבוץ')
  if (!workflow || !workflow.aiEvaluations.length) throw new HttpsError('failed-precondition', 'יש להכין את הערכות ההעדפות לפני השיבוץ')
  if (workflow.assignmentRun?.publishedAt) throw new HttpsError('failed-precondition', 'לא ניתן ליצור הרצה חדשה לאחר פרסום השיבוץ')
  const courses = (catalogSnapshot.data()?.courses ?? []) as Course[]
  const catalog = cycleCatalogSnapshot.data() as CycleCatalogSnapshot | undefined
  const submissions = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission))
  const profiles = await studentAssignmentProfiles(actor.organizationId, submissions.map((submission) => submission.studentId))
  const students: AssignmentStudent[] = submissions.map((submission) => {
    const profile = profiles.get(submission.studentId)
    const approved = workflow.aiEvaluations.filter((evaluation) => evaluation.studentId === submission.studentId && evaluation.approved)
    return { studentId: submission.studentId, displayLabel: profile?.displayLabel ?? 'תלמיד', classId: profile?.classId, classLabel: profile?.classLabel, submission,
      approvedAiByCluster: Object.fromEntries(approved.filter((evaluation) => !evaluation.approved?.coursePriorities).map((evaluation) => [evaluation.clusterId, evaluation.approved!.priority])),
      approvedAiByCourse: Object.fromEntries(approved.flatMap((evaluation) => evaluation.approved?.coursePriorities?.map((course) => [course.courseId, course.priority] as const) ?? [])) }
  })
  if (!catalog || courses.some(course=>!catalog.clusters.some(c=>c.clusterId===course.clusterId))) throw new HttpsError('failed-precondition', 'חסרות הגדרות מקבצים. יש לבדוק את התהליך לפני שיבוץ.')
  const clusterIds = [...new Set(courses.map((course) => course.clusterId))]
  const scope = participationScope(data.scope, new Set(clusterIds), new Set(students.map(student=>student.studentId)), new Set(students.map(student=>student.classId).filter((id): id is string=>Boolean(id))))
  const includedEvaluations = workflow.aiEvaluations.filter(evaluation=>{
    const student=students.find(entry=>entry.studentId===evaluation.studentId)
    return student && !excludedFromCluster(student,evaluation.clusterId,scope)
  })
  if (includedEvaluations.some(evaluation=>!evaluation.approved)) throw new HttpsError('failed-precondition', 'יש לאשר את הערכות ההעדפות של המשתתפים בהרצה')
  const eligiblePairs = students.flatMap(student=>clusterIds.filter(clusterId=>includesClass({eligibleClassIds:catalog.clusters.find(cluster=>cluster.clusterId===clusterId)?.eligibleClassIds},student.classId)).map(clusterId=>({student,clusterId})))
  const includedStudentClusterCount = eligiblePairs.filter(({student,clusterId})=>!excludedFromCluster(student,clusterId,scope)).length
  if (!includedStudentClusterCount) throw new HttpsError('failed-precondition', 'לא נותרו תלמידים לשיבוץ בהרצה זו')
  const calculated = runDeterministicAssignment({ cycleId, clusterIds, courses, students, eligibleClassIdsByCluster: Object.fromEntries(catalog.clusters.map(c => [c.clusterId, c.eligibleClassIds])), excludedClassIdsByCluster:scope.excludedClassIdsByCluster, excludedStudentIdsByCluster:scope.excludedStudentIdsByCluster, balanceByClassClusterIds: catalog.clusters.filter((cluster) => cluster.balanceByClass).map((cluster) => cluster.clusterId) })
  const result = { ...calculated, assignments: calculated.assignments.map((assignment) => ({ ...assignment, studentLabel: profiles.get(assignment.studentId)?.displayLabel ?? 'תלמיד', studentClassLabel: profiles.get(assignment.studentId)?.classLabel })) }
  const now = new Date().toISOString()
  const assignmentRun: AssignmentRun = { id:randomUUID(), label, executedAt:now, executedBy:actor.uid, algorithmVersion:'negative-last-resort-1.1.0', seed:42, scope, includedStudentClusterCount, excludedStudentClusterCount:eligiblePairs.length-includedStudentClusterCount, ...result }
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const [currentSnapshot, currentCycleSnapshot] = await transaction.getAll(reference, firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)))
    const current = currentSnapshot.data() as WorkflowState | undefined
    const currentCycle = currentCycleSnapshot.data() as AssignmentCycle | undefined
    if (!current || current.version !== workflow.version) throw new HttpsError('aborted', 'המידע השתנה; יש לרענן ולהריץ שוב')
    if (currentCycle?.status !== 'assignment') throw new HttpsError('failed-precondition', 'המחזור אינו במצב שיבוץ')
    if (current.assignmentRun?.publishedAt) throw new HttpsError('failed-precondition', 'לא ניתן ליצור הרצה חדשה לאחר פרסום השיבוץ')
    const next: WorkflowState = { ...current, assignmentRun, version: current.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(current, actor, 'assignment.run.executed', `הרצת שיבוץ: ${label}`, now) }
    transaction.create(firestore.doc(assignmentRunDocumentPath(actor.organizationId,cycleId,assignmentRun.id)), { ...assignmentRun, organizationId:actor.organizationId, cycleId })
    transaction.set(reference, next)
    return next
  })
})

export const listAssignmentRuns = onCall(callableOptions, async request => {
  const actor = await actorFromRequest(request, 'read')
  requireCapability(actor, 'nativ.assignment.manage')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const [runs, workflow] = await Promise.all([
    firestore.collection(assignmentRunsCollectionPath(actor.organizationId,cycleId)).orderBy('executedAt','desc').limit(20).get(),
    workflowRef(actor,cycleId).get(),
  ])
  const values = runs.docs.map(document=>assignmentRunFromStorage(document.data()))
  const active = workflow.data()?.assignmentRun as AssignmentRun | undefined
  if (active && !values.some(run=>run.id===active.id)) values.push(active)
  return values.sort((left,right)=>right.executedAt.localeCompare(left.executedAt))
})

export const selectAssignmentRun = onCall(callableOptions, async request => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.manage')
  const data=inputRecord(request.data),cycleId=requiredString(data,'cycleId'),runId=requiredString(data,'runId')
  return firestore.runTransaction(async transaction=>{
    const reference=workflowRef(actor,cycleId), runReference=firestore.doc(assignmentRunDocumentPath(actor.organizationId,cycleId,runId)), cycleReference=firestore.doc(cycleDocumentPath(actor.organizationId,cycleId))
    const [workflowSnapshot,runSnapshot,cycleSnapshot]=await transaction.getAll(reference,runReference,cycleReference)
    const current=workflowSnapshot.data() as WorkflowState | undefined, storedRun=runSnapshot.data() as (AssignmentRun&{cycleId?:string}) | undefined
    if (cycleSnapshot.data()?.status!=='assignment' || !current || current.assignmentRun?.publishedAt) throw new HttpsError('failed-precondition','אפשר לבחור הרצה רק לפני פרסום השיבוץ')
    if (data.expectedVersion !== undefined && current.version !== data.expectedVersion) throw new HttpsError('aborted','השיבוץ השתנה. רעננו את התוצאות לפני בחירת גרסה אחרת.')
    if (!storedRun || storedRun.cycleId!==cycleId || storedRun.rejectedAt) throw new HttpsError('not-found','הרצת השיבוץ אינה זמינה לבחירה')
    const run=assignmentRunFromStorage(storedRun)
    const now=new Date().toISOString(), next:WorkflowState={...current,assignmentRun:run,version:current.version+1,updatedAt:now,updatedBy:actor.uid,history:history(current,actor,'assignment.run.selected',`נבחרה הרצה: ${run.label??run.id}`,now)}
    transaction.set(reference,next);return next
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
    const readiness = runReadiness(workflow.assignmentRun)
    if (readiness.issues.length) throw new HttpsError('failed-precondition', `${readiness.issues.join(' ')} בדקו את משתתפי ההרצה וצרו שיבוץ מתוקן לפני האישור.`)
    const approvedRun:AssignmentRun = { ...workflow.assignmentRun, approvedAt: now, approvedBy: actor.uid }
    const next: WorkflowState = { ...workflow, assignmentRun: approvedRun, version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'assignment.run.approved', 'אישור מפורש של גרסת השיבוץ לפני פרסום', now) }
    transaction.set(firestore.doc(assignmentRunDocumentPath(actor.organizationId,cycleId,approvedRun.id)),{...approvedRun,organizationId:actor.organizationId,cycleId},{merge:true})
    transaction.set(reference, next)
    return next
  })
})

export const publishAssignments = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.publish')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const now = new Date().toISOString()
  const secretaryIds = (await firestore.collection(`organizations/${actor.organizationId}/accessAssignments`).where('roles', 'array-contains', 'secretary').get()).docs.filter((entry) => entry.data().active === true).map((entry) => entry.id)
  return firestore.runTransaction(async (transaction) => {
    const cycleReference = firestore.doc(cycleDocumentPath(actor.organizationId, cycleId))
    const workflowReference = workflowRef(actor, cycleId)
    const [cycleSnapshot, workflowSnapshot, catalogSnapshot] = await transaction.getAll(cycleReference, workflowReference, firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)))
    const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
    const workflow = workflowSnapshot.data() as WorkflowState | undefined
    if (cycle?.status !== 'assignment' || !workflow?.assignmentRun?.approvedAt) throw new HttpsError('failed-precondition', 'יש לאשר גרסת שיבוץ לפני הפרסום')
    const readiness = runReadiness(workflow.assignmentRun)
    if (readiness.issues.length) throw new HttpsError('failed-precondition', `${readiness.issues.join(' ')} צרו הרצה מתוקנת לפני הפרסום.`)
    const catalog = catalogSnapshot.data() as CycleCatalogSnapshot | undefined
    const notifications: NotificationRecord[] = workflow.assignmentRun.assignments.map(assignment=>{
      const cluster=catalog?.clusters.find(c=>c.clusterId===assignment.clusterId);const course=cluster?.courses.find(c=>c.courseId===assignment.courseId)
      if(!cluster || !course)throw new HttpsError('failed-precondition','חסרים פרטי קורס')
      return {id:randomUUID(),audience:'student',recipientRef:assignment.studentId,channel:'in_app',subject:'השיבוץ שלך פורסם',body:cluster.label+': '+course.label,status:'available',createdAt:now}
    })
    const publishedRun:AssignmentRun={...workflow.assignmentRun,publishedAt:now}
    const eventId = `${cycleId}-publication-${publishedRun.id}`
    const results: NonNullable<MailJob['results']> = workflow.assignmentRun.assignments.map((assignment) => {
      const cluster = catalog?.clusters.find((entry) => entry.clusterId === assignment.clusterId)
      const course = cluster?.courses.find((entry) => entry.courseId === assignment.courseId)
      if (!cluster || !course) throw new HttpsError('failed-precondition', 'חסרים פרטי קורס')
      return { studentId: assignment.studentId, name: assignment.studentLabel ?? 'תלמיד/ה', classLabel: assignment.studentClassLabel ?? '', clusterLabel: cluster.label, courseLabel: course.label, courseId: assignment.courseId }
    })
    if (results.length && Buffer.byteLength(JSON.stringify(results)) > 650000) throw new HttpsError('failed-precondition', 'דוח המזכירות גדול מדי לשליחה. פנו למנהל המערכת.')
    const mailJob: MailJob = { notificationId: eventId, audience: 'secretary', studentId: 'summary', recipientIds: secretaryIds, clusterLabel: '', afterCourseLabel: '', occurredAt: now, results }
    const nextWorkflow: WorkflowState = { ...workflow, assignmentRun: publishedRun, notifications: [...workflow.notifications, ...notifications, { id: eventId, audience: 'secretary', recipientRef: 'school-secretary', channel: 'email', subject: 'השיבוץ פורסם', body: 'סיכום השיבוץ נשלח למזכירות', status: 'queued', deliveryEventId: eventId, createdAt: now }], version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'assignment.published', 'פרסום נפרד של גרסת השיבוץ המאושרת', now) }
    const nextCycle = { ...cycle, status: 'published' as const, publishedAt: now, version: cycle.version + 1, updatedAt: now, updatedBy: actor.uid }
    transaction.set(workflowReference, nextWorkflow)
    transaction.set(firestore.doc(assignmentRunDocumentPath(actor.organizationId,cycleId,publishedRun.id)),{...publishedRun,organizationId:actor.organizationId,cycleId},{merge:true})
    transaction.set(cycleReference, nextCycle)
    transaction.create(firestore.doc(`organizations/${actor.organizationId}/mailEvents/${eventId}`), { organizationId: actor.organizationId, cycleId, jobs: [mailJob], status: secretaryIds.length ? 'queued' : 'failed', errorCode: secretaryIds.length ? null : 'no_active_secretary', attempts: 0, createdAt: now, createdBy: actor.uid })
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
  if (cycle.appealDeadlineEnabled && cycle.appealClosesAt && new Date(cycle.appealClosesAt).getTime() <= Date.now()) throw new HttpsError('failed-precondition', 'מועד הגשת הערעורים חלף. פנו לרכז אם דרושה הארכה.')
  const requestedCourse = ((coursesSnapshot.data()?.courses ?? []) as Course[]).find((course) => course.id === requestedCourseId)
  if (!requestedCourse?.published || requestedCourse.clusterId !== clusterId) throw new HttpsError('failed-precondition', 'הקורס המבוקש אינו זמין במקבץ שנבחר')
  const eligibilityCatalog = await firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get()
  const eligibleCluster = (eligibilityCatalog.data() as CycleCatalogSnapshot | undefined)?.clusters.find(c=>c.clusterId===clusterId)
  if (!eligibleCluster || !includesClass(eligibleCluster, actor.studentClassId)) throw new HttpsError('failed-precondition', 'המקבץ אינו פתוח לכיתתך. יש לפנות לרכז לבדיקת השיוך.')
  const original = latestSubmitted(submissionsSnapshot.docs.map((document) => document.data() as PreferenceSubmission))[0]
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const cycleReference = firestore.doc(cycleDocumentPath(actor.organizationId, cycleId))
    const [snapshot, currentCycleSnapshot] = await transaction.getAll(reference, cycleReference)
    const currentCycle = currentCycleSnapshot.data() as AssignmentCycle | undefined
    if (currentCycle?.status !== 'appeals' || (currentCycle.appealDeadlineEnabled && currentCycle.appealClosesAt && new Date(currentCycle.appealClosesAt).getTime() <= Date.now())) throw new HttpsError('failed-precondition', 'חלון הערעורים נסגר. רעננו את המסך או פנו לרכז אם דרושה הארכה.')
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
  const reason = requiredString(data, 'reason').trim().slice(0, 1000)
  if (!reason) throw new HttpsError('invalid-argument', 'יש לכתוב תשובה אישית לפני קבלת החלטה')
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
  try {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.manage')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const appealId = requiredString(data, 'appealId')
  const expectedWorkflowVersion = requiredInteger(data, 'expectedWorkflowVersion')
  const [coursesSnapshot, catalogSnapshot] = await Promise.all([firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(), firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get()])
  const courses = (coursesSnapshot.data()?.courses ?? []) as Course[]
  const now = new Date().toISOString()
  const secretaryIds = (await firestore.collection(`organizations/${actor.organizationId}/accessAssignments`).where('roles', 'array-contains', 'secretary').get()).docs.filter((entry) => entry.data().active === true).map((entry) => entry.id)
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState
    if (workflow.version !== expectedWorkflowVersion) throw new HttpsError('aborted', 'המידע השתנה; יש לבצע ניתוח השפעה מחדש')
    const appeal = workflow.appeals.find((entry) => entry.id === appealId)
    if (appeal?.status !== 'approved_pending_execution' || !workflow.assignmentRun) throw new HttpsError('failed-precondition', 'השינוי אינו מאושר לביצוע')
    const eligibilityCluster = (catalogSnapshot.data() as CycleCatalogSnapshot | undefined)?.clusters.find(c=>c.clusterId===appeal.clusterId)
    const profile = (await studentAssignmentProfiles(actor.organizationId, [appeal.studentId])).get(appeal.studentId)
    if (!eligibilityCluster || !includesClass(eligibilityCluster, profile?.classId)) throw new HttpsError('failed-precondition', 'כיתת התלמיד אינה משתתפת במקבץ. יש לבדוק את שיוך הכיתה לפני שינוי השיבוץ.')
    const fresh = analyze(workflow, appeal, courses, now)
    const nonCapacityViolations = fresh.constraintViolations.filter((violation) => !violation.includes('קיבולת המרבית'))
    if (nonCapacityViolations.length) throw new HttpsError('failed-precondition', 'השינוי מפר אילוץ שאינו ניתן לאישור במסלול זה', fresh)
    if (fresh.requiresMovingAnotherStudent) {
      if (!appeal.capacityOverride || appeal.capacityOverride.baseWorkflowVersion !== workflow.version) throw new HttpsError('failed-precondition', 'נדרש אישור חריגת קיבולת עדכני מרכז אחר')
      if (appeal.capacityOverride.approvedBy === actor.uid) throw new HttpsError('failed-precondition', 'מבצע השינוי חייב להיות אדם אחר ממאשר חריגת הקיבולת')
    }
    const previous = workflow.assignmentRun.assignments.find((entry) => entry.studentId === appeal.studentId && entry.clusterId === appeal.clusterId)!
    const appealRank = appeal.originalSubmission?.preferences.find(preference => preference.clusterId === appeal.clusterId)?.rankings.find(ranking => ranking.courseId === appeal.requestedCourseId)?.rank ?? null
    const assignments = workflow.assignmentRun.assignments.map((entry) => entry === previous ? { ...entry, courseId: appeal.requestedCourseId, rank: appealRank, source: 'hard_constraint' as const, explanation: `שינוי לאחר ערעור ${appeal.id}` } : entry)
    const counts = { ...workflow.assignmentRun.enrollmentByCourse, [previous.courseId]: workflow.assignmentRun.enrollmentByCourse[previous.courseId] - 1, [appeal.requestedCourseId]: (workflow.assignmentRun.enrollmentByCourse[appeal.requestedCourseId] ?? 0) + 1 }
    const cluster = (catalogSnapshot.data() as CycleCatalogSnapshot | undefined)?.clusters.find((entry) => entry.clusterId === appeal.clusterId)
    const beforeCourse = courses.find((entry) => entry.id === previous.courseId)
    const afterCourse = courses.find((entry) => entry.id === appeal.requestedCourseId)
    if (!cluster || !beforeCourse || !afterCourse) throw new HttpsError('failed-precondition', 'חסרים פרטי קורס; יש להשלים את הקטלוג לפני ביצוע השינוי')
    const eventId = `${cycleId}-appeal-change-${appealId}`
    const changeId = `appeal-${appealId}`
    const change: AssignmentChangeRecord = { id: changeId, cycleId, studentId: appeal.studentId, studentName: previous.studentLabel ?? profile?.displayLabel ?? 'תלמיד/ה', classLabel: previous.studentClassLabel ?? profile?.classLabel ?? '', clusterId: appeal.clusterId, clusterLabel: cluster.label, beforeCourseId: beforeCourse.id, beforeCourseLabel: beforeCourse.label, afterCourseId: afterCourse.id, afterCourseLabel: afterCourse.label, occurredAt: now, source: 'appeal', secretaryAutoEventId: eventId }
    const mailJob: MailJob = { notificationId: eventId, audience: 'secretary', studentId: appeal.studentId, recipientIds: secretaryIds, clusterLabel: cluster.label, beforeCourseLabel: beforeCourse.label, afterCourseLabel: afterCourse.label, occurredAt: now }
    const notifications: NotificationRecord[] = [
      {id:randomUUID(),audience:'secretary',recipientRef:'school-secretary',channel:'in_app',subject:'שינוי שיבוץ לאחר ערעור',body:beforeCourse.label+' ← '+afterCourse.label,status:'available',createdAt:now},
      {id:eventId,audience:'secretary',recipientRef:'school-secretary',channel:'email',subject:'שינוי שיבוץ לאחר ערעור',body:beforeCourse.label+' ← '+afterCourse.label,status:'queued',deliveryEventId:eventId,createdAt:now},
      {id:randomUUID(),audience:'student',recipientRef:appeal.studentId,channel:'in_app',subject:'הערעור בוצע',body:'השיבוץ עודכן ל-'+afterCourse.label,status:'available',createdAt:now},
    ]
    const next: WorkflowState = { ...workflow, assignmentRun: { ...workflow.assignmentRun, assignments, enrollmentByCourse: counts }, appeals: workflow.appeals.map((entry) => entry.id === appealId ? { ...entry, analysis: fresh, status: 'executed', executedAt: now, executedBy: actor.uid } : entry), notifications: [...workflow.notifications, ...notifications], version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'appeal.change.executed', `השיבוץ שונה מ-${previous.courseId} ל-${appeal.requestedCourseId} לאחר בדיקה חוזרת`, now) }
    transaction.set(reference, next)
    transaction.create(firestore.doc(`organizations/${actor.organizationId}/assignmentChanges/${cycleId}/entries/${changeId}`), change)
    transaction.create(firestore.doc(`organizations/${actor.organizationId}/mailEvents/${eventId}`), { organizationId: actor.organizationId, cycleId, jobs: [mailJob], status: secretaryIds.length ? 'queued' : 'failed', errorCode: secretaryIds.length ? null : 'no_active_secretary', attempts: 0, createdAt: now, createdBy: actor.uid })
    return next
  })
  } catch (error) { return operationalError(String(request.auth?.token.organizationId ?? ''), 'execute_appeal_change', error) }
})

export const saveManualProposedAssignment = onCall(callableOptions, async request => {
  try {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.assignment.manage')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const studentId = requiredString(data, 'studentId')
  const clusterId = requiredString(data, 'clusterId')
  const courseId = requiredString(data, 'courseId')
  const reason = requiredString(data, 'reason').trim().slice(0, 500)
  const expectedVersion = requiredInteger(data, 'expectedVersion')
  if (!reason) throw new HttpsError('invalid-argument', 'יש לציין סיבה לשיבוץ הידני')
  const [profile, submissions, catalogSnapshot, coursesSnapshot] = await Promise.all([
    studentAssignmentProfiles(actor.organizationId, [studentId]),
    firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).where('studentId', '==', studentId).get(),
    firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
  ])
  const student = profile.get(studentId)
  const cluster = (catalogSnapshot.data() as CycleCatalogSnapshot | undefined)?.clusters.find(entry => entry.clusterId === clusterId)
  const course = ((coursesSnapshot.data()?.courses ?? []) as Course[]).find(entry => entry.id === courseId && entry.clusterId === clusterId && entry.published)
  const submitted = latestSubmitted(submissions.docs.map(entry => entry.data() as PreferenceSubmission))[0]
  if (!student || !cluster || !course || !submitted?.preferences.some(entry => entry.clusterId === clusterId) || !includesClass(cluster, student.classId)) throw new HttpsError('failed-precondition', 'התלמיד או הקורס אינם משתתפים במקבץ. בדקו את הכיתה, ההגשה והקורס.')
  return firestore.runTransaction(async transaction => {
    const reference = workflowRef(actor, cycleId)
    const cycleReference = firestore.doc(cycleDocumentPath(actor.organizationId, cycleId))
    const [snapshot, cycleSnapshot] = await transaction.getAll(reference, cycleReference)
    const workflow = snapshot.data() as WorkflowState | undefined
    const parent = workflow?.assignmentRun
    if (cycleSnapshot.data()?.status !== 'assignment' || !parent || parent.publishedAt) throw new HttpsError('failed-precondition', 'שיבוץ ידני מוצע אפשרי רק לפני פרסום ההרצה')
    if (workflow!.version !== expectedVersion) throw new HttpsError('aborted', 'ההרצה השתנתה. רעננו את התוצאות לפני שמירת השיבוץ הידני.')
    if (parent.scope?.excludedClassIdsByCluster[clusterId]?.includes(student.classId ?? '') || parent.scope?.excludedStudentIdsByCluster[clusterId]?.includes(studentId)) throw new HttpsError('failed-precondition', 'התלמיד הוחרג מהמקבץ בהרצה זו. החזירו אותו למשתתפים וצרו הרצה חדשה לפני שיבוץ ידני.')
    const previous = parent.assignments.find(entry => entry.studentId === studentId && entry.clusterId === clusterId)
    if (previous?.courseId === courseId) throw new HttpsError('already-exists', 'התלמיד כבר משובץ לקורס הזה')
    const currentCount = parent.enrollmentByCourse[courseId] ?? 0
    if (currentCount >= course.capacity.maximum) throw new HttpsError('failed-precondition', `בקורס ${course.label} אין מקום פנוי. בחרו קורס אחר או צרו הרצה חדשה עם מכסה מתאימה.`)
    const allCourses = (coursesSnapshot.data()?.courses ?? []) as Course[]
    if (course.repeatPolicy === 'prohibited' && parent.assignments.some(entry => entry.studentId === studentId && entry.clusterId !== clusterId && allCourses.find(item => item.id === entry.courseId)?.logicalCourseId === course.logicalCourseId)) throw new HttpsError('failed-precondition', 'התלמיד כבר שובץ לאותו קורס במקבץ אחר, ומדיניות החזרה אינה מאפשרת זאת.')
    const rank = submitted.preferences.find(entry => entry.clusterId === clusterId)?.rankings.find(entry => entry.courseId === courseId)?.rank ?? null
    const replacement = { studentId, studentLabel: student.displayLabel, studentClassLabel: student.classLabel, clusterId, courseId, rank, source: 'manual' as const, aiPriority: 'neutral' as const, explanation: 'שיבוץ ידני בידי רכז' }
    const assignments = previous ? parent.assignments.map(entry => entry === previous ? replacement : entry) : [...parent.assignments, replacement]
    const enrollmentByCourse = { ...parent.enrollmentByCourse, [courseId]: currentCount + 1 }
    if (previous) enrollmentByCourse[previous.courseId] = Math.max(0, (enrollmentByCourse[previous.courseId] ?? 0) - 1)
    const now = new Date().toISOString()
    const run: AssignmentRun = { ...parent, id: randomUUID(), parentRunId: parent.id, label: `${parent.label ?? 'הרצה'} — תיקון ידני`, executedAt: now, executedBy: actor.uid, assignments, enrollmentByCourse,
      warnings: parent.warnings.filter(warning => warning !== `${student.displayLabel}: לא נמצא מקום פנוי במקבץ ${clusterId}`),
      manualChanges: [...(parent.manualChanges ?? []), { studentId, clusterId, ...(previous ? { beforeCourseId: previous.courseId } : {}), afterCourseId: courseId, changedAt: now, changedBy: actor.uid, reason }] }
    delete run.approvedAt; delete run.approvedBy; delete run.publishedAt; delete run.rejectedAt; delete run.rejectedBy; delete run.rejectionReason
    const next: WorkflowState = { ...workflow!, assignmentRun: run, version: workflow!.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow!, actor, 'assignment.proposed.manual_change', `תיקון ידני בהרצה: ${reason}`, now) }
    transaction.create(firestore.doc(assignmentRunDocumentPath(actor.organizationId, cycleId, run.id)), { ...run, organizationId: actor.organizationId, cycleId })
    transaction.set(reference, next)
    return next
  })
  } catch (error) { return operationalError(String(request.auth?.token.organizationId ?? ''), 'save_manual_proposed_assignment', error) }
})

export const approveAiEvaluations = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  requireCapability(actor, 'nativ.ai.review')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const mode = requiredString(data, 'mode')
  const expectedVersion = requiredInteger(data, 'expectedVersion')
  if (mode !== 'clear_only' && mode !== 'all') throw new HttpsError('invalid-argument', 'מצב האישור אינו תקין')
  const now = new Date().toISOString()
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const cycleReference = firestore.doc(cycleDocumentPath(actor.organizationId, cycleId))
    const [snapshot, cycleSnapshot] = await Promise.all([transaction.get(reference), transaction.get(cycleReference)])
    const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
    if (!cycle || !['choice_closed', 'assignment'].includes(cycle.status)) throw new HttpsError('failed-precondition', 'אפשר לאשר הערכות רק אחרי סגירת הבחירה ולפני פרסום השיבוץ')
    if (!snapshot.exists) throw new HttpsError('not-found', 'לא נמצאו הערכות לאישור')
    const current = snapshot.data() as WorkflowState
    if (current.version !== expectedVersion) throw new HttpsError('aborted', 'הערכות ההעדפות השתנו. רעננו ובדקו שוב לפני אישור מרוכז.')
    if (!current.aiBatchCreatedAt || !current.aiEvaluations.length) throw new HttpsError('failed-precondition', 'ההערכות טרם הוכנו. יש ליצור אותן לפני האישור.')
    if (current.assignmentRun) throw new HttpsError('failed-precondition', 'כבר נוצרה הרצת שיבוץ. יש לבדוק אותה לפני אישור הערכות נוספות.')
    const selected = current.aiEvaluations.filter((evaluation) => !evaluation.approved && !evaluation.raw.coursePriorities?.some((course) => course.priority === 'negative') && (mode === 'all' || !needsIndividualAiReview(evaluation)))
    if (!selected.length) throw new HttpsError('failed-precondition', 'אין הערכות מתאימות לאישור במצב שנבחר')
    const ids = new Set(selected.map((evaluation) => evaluation.id))
    const evaluations = current.aiEvaluations.map((evaluation) => ids.has(evaluation.id) ? { ...evaluation, approved: { priority: evaluation.raw.priority, summary: evaluation.raw.summary, reason: mode === 'all' ? 'אישור מרוכז של הרכז' : 'אישור מרוכז לאחר סינון מקרים לבדיקה', approvedAt: now, approvedBy: actor.uid,
      ...(evaluation.raw.coursePriorities ? { coursePriorities: evaluation.raw.coursePriorities.map((course) => ({ courseId: course.courseId, priority: course.priority })) } : {}) } } : evaluation)
    const next = { ...current, aiEvaluations: evaluations, version: current.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(current, actor, 'ai.evaluations.bulk_approved', `אושרו ${selected.length} הערכות באופן מרוכז`, now) }
    transaction.set(reference, next)
    return next
  })
})

export const changeStudentAssignment = onCall(callableOptions, async (request) => {
  try {
  const actor = await actorFromRequest(request, 'write')
  requireCapability(actor, 'nativ.assignment.manage')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const studentId = requiredString(data, 'studentId')
  const clusterId = requiredString(data, 'clusterId')
  const requestedCourseId = requiredString(data, 'requestedCourseId')
  const reason = requiredString(data, 'reason').slice(0, 500)
  const expectedWorkflowVersion = requiredInteger(data, 'expectedWorkflowVersion')
  const [cycleSnapshot, coursesSnapshot, catalogSnapshot, submissionsSnapshot] = await Promise.all([
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', cycleId).where('studentId', '==', studentId).get(),
  ])
  if (!['published', 'appeals'].includes(String(cycleSnapshot.data()?.status))) throw new HttpsError('failed-precondition', 'שינוי ידני אפשרי רק לאחר פרסום השיבוץ ולפני סיום המחזור')
  const courses = (coursesSnapshot.data()?.courses ?? []) as Course[]
  const cluster = (catalogSnapshot.data() as CycleCatalogSnapshot | undefined)?.clusters.find((entry) => entry.clusterId === clusterId)
  const afterCourse = courses.find((entry) => entry.id === requestedCourseId && entry.clusterId === clusterId && entry.published)
  if (!cluster || !afterCourse) throw new HttpsError('failed-precondition', 'הקורס המבוקש אינו זמין במקבץ שנבחר')
  const profile = (await studentAssignmentProfiles(actor.organizationId, [studentId])).get(studentId)
  const submitted = latestSubmitted(submissionsSnapshot.docs.map(entry => entry.data() as PreferenceSubmission))[0]
  const newRank = submitted?.preferences.find(entry => entry.clusterId === clusterId)?.rankings.find(entry => entry.courseId === requestedCourseId)?.rank ?? null
  if (!includesClass(cluster, profile?.classId)) throw new HttpsError('failed-precondition', 'כיתת התלמיד אינה משתתפת במקבץ זה')
  const secretaryIds = (await firestore.collection(`organizations/${actor.organizationId}/accessAssignments`).where('roles', 'array-contains', 'secretary').get()).docs.filter((entry) => entry.data().active === true).map((entry) => entry.id)
  const now = new Date().toISOString()
  const changeId = `manual-${randomUUID()}`
  return firestore.runTransaction(async (transaction) => {
    const reference = workflowRef(actor, cycleId)
    const snapshot = await transaction.get(reference)
    const workflow = snapshot.data() as WorkflowState | undefined
    if (!workflow?.assignmentRun?.publishedAt || workflow.version !== expectedWorkflowVersion) throw new HttpsError('aborted', 'השיבוץ השתנה מאז הטעינה. רעננו ובדקו מחדש לפני ביצוע שינוי')
    const previous = workflow.assignmentRun.assignments.find((entry) => entry.studentId === studentId && entry.clusterId === clusterId)
    if (!previous) throw new HttpsError('failed-precondition', 'לתלמיד אין שיבוץ במקבץ שנבחר')
    if (previous.courseId === requestedCourseId) throw new HttpsError('failed-precondition', 'התלמיד כבר משובץ לקורס הזה')
    if (workflow.appeals.some((entry) => entry.studentId === studentId && entry.clusterId === clusterId && !['executed', 'rejected'].includes(entry.status))) throw new HttpsError('failed-precondition', 'לתלמיד יש ערעור פתוח במקבץ זה. השלימו את הטיפול בו לפני שינוי ידני')
    const beforeCourse = courses.find((entry) => entry.id === previous.courseId)
    if (!beforeCourse) throw new HttpsError('failed-precondition', 'הקורס הנוכחי אינו קיים בקטלוג')
    const afterCount = (workflow.assignmentRun.enrollmentByCourse[afterCourse.id] ?? 0) + 1
    if (afterCount > afterCourse.capacity.maximum) throw new HttpsError('failed-precondition', `בקורס ${afterCourse.label} אין מקום פנוי. בדקו את המכסה או בחרו קורס אחר`)
    const duplicate = workflow.assignmentRun.assignments.some((entry) => entry.studentId === studentId && entry.clusterId !== clusterId && courses.find((course) => course.id === entry.courseId)?.logicalCourseId === afterCourse.logicalCourseId)
    if (duplicate && afterCourse.repeatPolicy === 'prohibited') throw new HttpsError('failed-precondition', 'מדיניות הקורס אינה מאפשרת לתלמיד להשתתף בו שוב')
    const assignments = workflow.assignmentRun.assignments.map((entry) => entry === previous ? { ...entry, courseId: afterCourse.id, rank: newRank, source: 'manual' as const, explanation: 'שינוי ידני בידי רכז' } : entry)
    const counts = { ...workflow.assignmentRun.enrollmentByCourse, [beforeCourse.id]: workflow.assignmentRun.enrollmentByCourse[beforeCourse.id] - 1, [afterCourse.id]: afterCount }
    const eventId = `${cycleId}-${changeId}`
    const change: AssignmentChangeRecord = { id: changeId, cycleId, studentId, studentName: previous.studentLabel ?? profile?.displayLabel ?? 'תלמיד/ה', classLabel: previous.studentClassLabel ?? profile?.classLabel ?? '', clusterId, clusterLabel: cluster.label, beforeCourseId: beforeCourse.id, beforeCourseLabel: beforeCourse.label, afterCourseId: afterCourse.id, afterCourseLabel: afterCourse.label, occurredAt: now, source: 'manual', secretaryAutoEventId: eventId }
    const mailJob: MailJob = { notificationId: eventId, audience: 'secretary', studentId, recipientIds: secretaryIds, clusterLabel: cluster.label, beforeCourseLabel: beforeCourse.label, afterCourseLabel: afterCourse.label, occurredAt: now }
    const notifications: NotificationRecord[] = [
      { id: randomUUID(), audience: 'student', recipientRef: studentId, channel: 'in_app', subject: 'השיבוץ שלך עודכן', body: `השיבוץ במקבץ ${cluster.label} עודכן ל${afterCourse.label}`, status: 'available', createdAt: now },
      { id: eventId, audience: 'secretary', recipientRef: 'school-secretary', channel: 'email', subject: 'שינוי שיבוץ', body: `${beforeCourse.label} ← ${afterCourse.label}`, status: 'queued', deliveryEventId: eventId, createdAt: now },
    ]
    const next: WorkflowState = { ...workflow, assignmentRun: { ...workflow.assignmentRun, assignments, enrollmentByCourse: counts }, notifications: [...workflow.notifications, ...notifications], version: workflow.version + 1, updatedAt: now, updatedBy: actor.uid, history: history(workflow, actor, 'assignment.manual_change.executed', reason, now) }
    transaction.set(reference, next)
    transaction.create(firestore.doc(`organizations/${actor.organizationId}/assignmentChanges/${cycleId}/entries/${changeId}`), change)
    transaction.create(firestore.doc(`organizations/${actor.organizationId}/mailEvents/${eventId}`), { organizationId: actor.organizationId, cycleId, jobs: [mailJob], status: secretaryIds.length ? 'queued' : 'failed', errorCode: secretaryIds.length ? null : 'no_active_secretary', attempts: 0, createdAt: now, createdBy: actor.uid })
    return { workflow: next, changeId }
  })
  } catch (error) { return operationalError(String(request.auth?.token.organizationId ?? ''), 'change_student_assignment', error) }
})

export const rejectAssignmentRun=onCall(callableOptions,async request=>{
  const actor=await actorFromRequest(request);requireCapability(actor,'nativ.assignment.manage')
  const data=inputRecord(request.data),cycleId=requiredString(data,'cycleId'),reason=requiredString(data,'reason')
  return firestore.runTransaction(async tx=>{
    const reference=workflowRef(actor,cycleId);const [snapshot,cycle]=await tx.getAll(reference,firestore.doc(cycleDocumentPath(actor.organizationId,cycleId)))
    const current=snapshot.data() as WorkflowState
    if(cycle.data()?.status!=='assignment' || !current?.assignmentRun || current.assignmentRun.publishedAt)throw new HttpsError('failed-precondition','אפשר לדחות רק הצעת שיבוץ שטרם פורסמה')
    if(current.version!==data.expectedVersion)throw new HttpsError('aborted','השיבוץ השתנה. יש לרענן לפני דחייה.')
    const now=new Date().toISOString(),rejectedRun:AssignmentRun={...current.assignmentRun,rejectedBy:actor.uid,rejectedAt:now,rejectionReason:reason}
    tx.set(firestore.doc(assignmentRunDocumentPath(actor.organizationId,cycleId,rejectedRun.id)),{...rejectedRun,organizationId:actor.organizationId,cycleId},{merge:true})
    tx.create(firestore.doc(`organizations/${actor.organizationId}/rejectedAssignmentRuns/${current.assignmentRun.id}`),{...rejectedRun,cycleId,reason})
    const {assignmentRun: _run,...rest}=current
    const next:WorkflowState={...rest,version:current.version+1,updatedAt:now,updatedBy:actor.uid,history:history(current,actor,'assignment.rejected',reason,now)}
    tx.set(reference,next);return next
  })
})
