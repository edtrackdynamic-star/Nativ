import { isCurrentYearWindow } from '../../src/domain/schoolYear'
import { eligibleClasses } from './classDirectory'
import { parseFormDesign, safeLink } from '../../src/domain/formDesign'
import { isValidChoiceDeadline } from '../../src/domain/choiceDeadline'
import { validRankingCount } from '../../src/domain/rankingPolicy'
import { randomUUID } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { NativCommandService } from '../../src/application/NativCommandService'
import { AuthorizationError, EntityNotFoundError, IdempotencyConflictError } from '../../src/application/errors'
import { cycleStatuses, type AssignmentCycle } from '../../src/domain/cycle'
import type { ClusterPreference, PreferenceSubmission } from '../../src/domain/preferences'
import type { Course, CycleCatalogSnapshot, RepeatPolicy } from '../../src/domain/catalog'
import type { WorkflowState } from '../../src/domain/workflow'
import { ConcurrentModificationError, DomainValidationError } from '../../src/domain/types'
import { demoCatalogSnapshot, demoCourses, demoCycle } from '../../src/demo/demoCycle'
import { FirestoreNativRepository } from '../../server/firestore/FirestoreNativRepository'
import { catalogSnapshotDocumentPath, courseCatalogDocumentPath, cycleDocumentPath, workflowDocumentPath } from '../../server/firestore/paths'
import { callableOptions, coreFirestore, nativFirestore as firestore } from './firebase'
import { actorFromRequest, inputRecord, requiredInteger, requiredString } from './request'
import { verifyStoredCycleDocument } from './courseDescriptionImport'
import { syncInstructorAccess } from './instructorAccess'

const service = new NativCommandService(new FirestoreNativRepository(firestore))

export { changeStudentAssignment, rejectAssignmentRun, analyzeAppeal, approveAiEvaluation, approveAssignmentRun, approveCapacityOverride, decideAppeal, executeAppealChange, generateAiEvaluations, getWorkflow, listAssignmentRuns, publishAssignments, recommendAppeal, runAssignment, selectAssignmentRun, submitAppeal } from './workflowCallables'
export { claimInitialAccessManager, getMyNativAccess, listAccessUsers, setUserAccess } from './accessCallablesV2'
export { deliverNativMail } from './mailDelivery'
export { getStudentRoster } from './studentRoster'
export { downloadCycleDocument, extractCourseDescriptions, uploadCycleDocument } from './courseDescriptionImport'

function mapError(error: unknown): never {
  if (error instanceof HttpsError) throw error
  if (error instanceof AuthorizationError) throw new HttpsError('permission-denied', error.message)
  if (error instanceof EntityNotFoundError) throw new HttpsError('not-found', error.message)
  if (error instanceof ConcurrentModificationError || error instanceof IdempotencyConflictError) throw new HttpsError('aborted', error.message)
  if (error instanceof DomainValidationError) throw new HttpsError('failed-precondition', error.message, { issues: error.issues })
  console.error('Unexpected Nativ callable failure', error)
  throw new HttpsError('internal', 'הפעולה נכשלה')
}

function parsePreferences(value: unknown): ClusterPreference[] {
  if (!Array.isArray(value)) throw new HttpsError('invalid-argument', 'נדרשת רשימת העדפות')
  return value as ClusterPreference[]
}

export const getPreparationStatus = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  return { status: process.env.FUNCTIONS_EMULATOR === 'true' ? 'local_mvp' : 'cloud_connected', organizationId: actor.organizationId, roles: actor.roles, accessMode: actor.accessMode, liveDataConnected: process.env.FUNCTIONS_EMULATOR !== 'true', edTrackDirectoryConnected: process.env.FUNCTIONS_EMULATOR !== 'true', geminiConnected: process.env.FUNCTIONS_EMULATOR !== 'true' }
})

export const getCycle = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request, 'read')
    const data = inputRecord(request.data)
    const cycleId = requiredString(data, 'cycleId')
    if (actor.roles.includes('student')) {
      const snapshot = await firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get()
      if (!snapshot.exists) throw new HttpsError('not-found', 'המחזור לא נמצא')
      return snapshot.data()
    }
    return await service.getCycle(actor, cycleId)
  } catch (error) { return mapError(error) }
})

export const listCycles = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.roles.length) throw new HttpsError('permission-denied', 'לא הוקצה תפקיד בנתיב')
  const snapshot = await firestore.collection(`organizations/${actor.organizationId}/nativCycles`).get()
  const cycles = snapshot.docs.map((entry) => entry.data() as AssignmentCycle)
  if (actor.roles.includes('student') && !actor.capabilities.includes('nativ.assignment.view')) return cycles.filter((cycle) => ['choice_open', 'published', 'appeals', 'closed'].includes(cycle.status)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return cycles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})

export const createCycle = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה להקים מחזור')
  const data = inputRecord(request.data)
  const schoolYear = requiredString(data, 'schoolYear')
  if (!isCurrentYearWindow(schoolYear)) throw new HttpsError('invalid-argument', 'יש לבחור את שנת הלימודים הקודמת, הנוכחית או הבאה מתוך הרשימה. אם השנה התחלפה, רעננו את המסך.')
  const termLabel = requiredString(data, 'termLabel')
  const now = new Date().toISOString()
  const id = `cycle-${randomUUID()}`
  const cycle: AssignmentCycle = { id, organizationId: actor.organizationId, schoolYear, termLabel, status: 'draft', appealWindowSchoolDays: 5, rulesVersion: '1.0.0', version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid }
  const batch = firestore.batch()
  batch.create(firestore.doc(cycleDocumentPath(actor.organizationId, id)), cycle)
  batch.create(firestore.collection(`organizations/${actor.organizationId}/nativAuditEvents`).doc(), { id: randomUUID(), organizationId: actor.organizationId, actorId: actor.uid, occurredAt: now, action: 'cycle.created', entityType: 'AssignmentCycle', entityId: id, reason: `הקמת מחזור ${schoolYear} ${termLabel}`, afterVersion: 1 })
  await batch.commit()
  return cycle
})

export const setChoiceDeadline = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לשנות את מועד ההגשה')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const expectedVersion = requiredInteger(data, 'expectedVersion')
  const deadline = data.choiceClosesAt
  if (deadline !== null && (typeof deadline !== 'string' || !isValidChoiceDeadline(deadline))) throw new HttpsError('invalid-argument', 'מועד הסגירה אינו תקין')
  const now = new Date().toISOString()
  if (deadline && deadline <= now) throw new HttpsError('invalid-argument', 'יש לבחור מועד סגירה עתידי')
  return firestore.runTransaction(async transaction => {
    const reference = firestore.doc(cycleDocumentPath(actor.organizationId, cycleId))
    const snapshot = await transaction.get(reference)
    const cycle = snapshot.data() as AssignmentCycle | undefined
    if (!cycle) throw new HttpsError('not-found', 'התהליך לא נמצא')
    if (cycle.version !== expectedVersion) throw new HttpsError('aborted', 'התהליך השתנה. רעננו לפני שינוי המועד.')
    if (!['draft', 'choice_open'].includes(cycle.status)) throw new HttpsError('failed-precondition', 'אפשר לשנות את המועד רק לפני סיום שלב הבחירה')
    const updated: AssignmentCycle = { ...cycle, choiceDeadlineEnabled: Boolean(deadline), ...(deadline ? { choiceClosesAt: deadline } : {}), version: cycle.version + 1, updatedAt: now, updatedBy: actor.uid }
    if (!deadline) delete updated.choiceClosesAt
    transaction.set(reference, updated)
    transaction.create(firestore.collection(`organizations/${actor.organizationId}/nativAuditEvents`).doc(), { id: randomUUID(), organizationId: actor.organizationId, actorId: actor.uid, occurredAt: now, action: 'cycle.choice_deadline.updated', entityType: 'AssignmentCycle', entityId: cycleId, reason: deadline ? `מועד הגשה: ${deadline}` : 'בוטל מועד ההגשה', beforeVersion: cycle.version, afterVersion: updated.version })
    return updated
  })
})

interface CatalogCourseInput { capacityLimit?: number; documentUrl?: string; imageUrl?: string; label: string; description?: string; subjectArea?: string; instructorIds: string[]; minimum: number; target: number; maximum: number; repeatPolicy: RepeatPolicy }
interface CatalogClusterInput { capacityFlexibility?: number; eligibleClassIds?: string[]; description?: string; rationaleMode?: 'optional' | 'required' | 'hidden'; label: string; requiredRankingCount: number; balanceByClass?: boolean; courses: CatalogCourseInput[] }

export const saveCycleCatalog = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לעדכן קורסים')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  if (!Array.isArray(data.clusters) || !data.clusters.length) throw new HttpsError('invalid-argument', 'נדרש לפחות מקבץ אחד')
  const clusters = data.clusters as CatalogClusterInput[]
  if(clusters.length>20 || clusters.some(c=>!Array.isArray(c.courses) || c.courses.length>40)) throw new HttpsError('invalid-argument','אפשר להגדיר עד 20 מקבצים ועד 40 קורסים במקבץ')
  let formDesign: ReturnType<typeof parseFormDesign>
  try { formDesign = parseFormDesign(data.formDesign); for(const c of clusters) for(const course of c.courses){safeLink(course.documentUrl,true);safeLink(course.imageUrl)} }
  catch(error){throw new HttpsError('invalid-argument',error instanceof Error?error.message:'עיצוב הטופס אינו תקין')}
  if (formDesign.documentStoragePath && !formDesign.documentStoragePath.startsWith(`organizations/${actor.organizationId}/nativCycles/${cycleId}/source-documents/`)) throw new HttpsError('permission-denied', 'מסמך Word אינו שייך למחזור')
  if (formDesign.documentStoragePath) await verifyStoredCycleDocument(formDesign.documentStoragePath)
  const availableClasses = new Set((await eligibleClasses(actor.organizationId)).map(c => c.id))
  for (const cluster of clusters) {
    if (cluster.eligibleClassIds !== undefined && (!Array.isArray(cluster.eligibleClassIds) || !cluster.eligibleClassIds.length || cluster.eligibleClassIds.some(id => typeof id !== 'string' || !availableClasses.has(id)))) throw new HttpsError('invalid-argument', 'יש לבחור לפחות כיתה פעילה אחת לכל מקבץ מוגבל, או לבחור בכל הכיתות')
  }
  const teacherIds = [...new Set(clusters.flatMap(c=>c.courses.flatMap(course=>Array.isArray(course.instructorIds)?course.instructorIds:[])))]
  if(teacherIds.some(id=>typeof id!=='string' || !id || id.includes('/')))throw new HttpsError('invalid-argument','מזהה מנחה אינו תקין')
  const teachers = new Map<string,string>()
  if(process.env.FUNCTIONS_EMULATOR==='true'){
    for(const id of teacherIds){const user=await getAuth().getUser(id);if(user.customClaims?.organizationId!==actor.organizationId || user.customClaims?.active!==true || user.customClaims?.roles?.includes('student'))throw new HttpsError('permission-denied','המנחה אינו חבר צוות פעיל בבית הספר');teachers.set(id,user.displayName||user.email||'מורה')}
  }else if(teacherIds.length){
    const members=await coreFirestore.getAll(...teacherIds.map(id=>coreFirestore.doc(`organizations/${actor.organizationId}/members/${id}`)))
    for(const member of members){if(member.data()?.active!==true || !['teacher','school_admin'].includes(member.data()?.role))throw new HttpsError('permission-denied','המנחה אינו חבר צוות פעיל בבית הספר');teachers.set(member.id,String(member.data()?.fullName??'מורה'))}
  }
  const now = new Date().toISOString()
  const base = { organizationId: actor.organizationId, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid }
  const courses: Course[] = []
  const catalogClusters = clusters.map((cluster, clusterIndex) => {
    const label = typeof cluster.label === 'string' ? cluster.label.trim() : ''
    if (!label || !Array.isArray(cluster.courses) || !validRankingCount(cluster.courses.length,cluster.requiredRankingCount)) throw new HttpsError('invalid-argument', 'מספר הקורסים לדירוג חייב להיות לפחות שלושה, או כל הקורסים במקבץ שיש בו פחות משלושה')
    const clusterId = `cluster-${randomUUID()}`
    if (cluster.capacityFlexibility !== undefined && (!Number.isSafeInteger(cluster.capacityFlexibility) || cluster.capacityFlexibility < 0)) throw new HttpsError('invalid-argument', 'גמישות הקיבולת אינה תקינה')
    const snapshotCourses = cluster.courses.map((course) => {
      if (course.capacityLimit !== undefined && (!Number.isSafeInteger(course.capacityLimit) || course.capacityLimit < 1 || course.maximum > course.capacityLimit)) throw new HttpsError('invalid-argument', 'המכסה חייבת להיות חיובית ולא קטנה מהמספר המרבי')
      const courseLabel = typeof course.label === 'string' ? course.label.trim() : ''
      const instructorIds = Array.isArray(course.instructorIds) ? course.instructorIds.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())) : []
      if (!courseLabel || !instructorIds.length || ![course.minimum, course.target, course.maximum].every(Number.isInteger) || course.minimum < 0 || course.minimum > course.target || course.target > course.maximum) throw new HttpsError('invalid-argument', `יש להשלים מנחה וקיבולת תקינה בקורס ${courseLabel || 'ללא שם'}`)
      if (!['allowed', 'approval_required', 'discouraged', 'prohibited'].includes(course.repeatPolicy)) throw new HttpsError('invalid-argument', 'מדיניות החזרה אינה תקינה')
      if(course.maximum<1)throw new HttpsError('invalid-argument','מקסימום התלמידים חייב להיות חיובי')
      const courseId = `course-${randomUUID()}`
      courses.push({ ...base, id: courseId, cycleId, clusterId, logicalCourseId: courseId, label: courseLabel, description: String(course.description ?? '').trim().slice(0,4000), documentUrl:safeLink(course.documentUrl,true), imageUrl:safeLink(course.imageUrl), subjectArea: String(course.subjectArea ?? '').trim(), instructorIds, slot: `slot-${clusterIndex + 1}`, eligibleGradeIds: [], capacity: { ...(course.capacityLimit === undefined ? {} : {limit: course.capacityLimit}), minimum: course.minimum, target: course.target, maximum: course.maximum }, repeatPolicy: course.repeatPolicy, published: true })
      return { courseId, logicalCourseId: courseId, label: courseLabel, description:String(course.description??'').trim().slice(0,4000), documentUrl:safeLink(course.documentUrl,true), imageUrl:safeLink(course.imageUrl), instructorNames:instructorIds.map(id=>teachers.get(id)!) }
    })
    if(cluster.rationaleMode && !['optional','required','hidden'].includes(cluster.rationaleMode))throw new HttpsError('invalid-argument','מצב שדה ההסבר אינו תקין')
    return { clusterId, ...(cluster.capacityFlexibility === undefined ? {} : {capacityFlexibility: cluster.capacityFlexibility}), ...(cluster.eligibleClassIds === undefined ? {} : { eligibleClassIds: [...new Set(cluster.eligibleClassIds)] }), label, description:String(cluster.description??'').slice(0,2000), rationaleMode:cluster.rationaleMode??'optional', requiredRankingCount: cluster.requiredRankingCount, balanceByClass: cluster.balanceByClass === true, courses: snapshotCourses }
  })
  const catalog: CycleCatalogSnapshot = { ...base, id: `catalog-${cycleId}`, cycleId, formDesign, clusters: catalogClusters }
  return firestore.runTransaction(async (transaction) => {
    const cycleReference = firestore.doc(cycleDocumentPath(actor.organizationId, cycleId))
    const cycleSnapshot = await transaction.get(cycleReference)
    const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
    if(data.expectedVersion!==undefined && cycle?.version!==data.expectedVersion)throw new HttpsError('aborted','התהליך השתנה מאז פתיחת העורך. פתחו אותו מחדש לפני שמירה.')
    if (cycle?.status !== 'draft') throw new HttpsError('failed-precondition', 'ניתן לערוך קורסים רק לפני פתיחת הבחירה')
    await syncInstructorAccess(transaction, actor.organizationId, cycleId, teacherIds)
    transaction.set(firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)), catalog)
    transaction.set(firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)), { organizationId: actor.organizationId, cycleId, courses, updatedAt: now, updatedBy: actor.uid })
    transaction.set(cycleReference, { ...cycle, version: cycle.version + 1, updatedAt: now, updatedBy: actor.uid })
    transaction.create(firestore.collection(`organizations/${actor.organizationId}/nativAuditEvents`).doc(), { id: randomUUID(), organizationId: actor.organizationId, actorId: actor.uid, occurredAt: now, action: 'catalog.saved', entityType: 'AssignmentCycle', entityId: cycleId, reason: `שמירת ${catalogClusters.length} מקבצים ו-${courses.length} קורסים`, beforeVersion: cycle.version, afterVersion: cycle.version + 1 })
    return catalog
  })
})

export const listEligibleClasses = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לצפות ברשימת הכיתות')
  return eligibleClasses(actor.organizationId)
})

export const listEligibleInstructors = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לצפות ברשימת המנחים')
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const result = await getAuth().listUsers(1000)
    return result.users.filter((user) => user.customClaims?.organizationId === actor.organizationId && !user.customClaims?.roles?.includes('student')).map((user) => ({ uid: user.uid, displayName: user.displayName || user.email || 'חבר צוות' }))
  }
  const members = await coreFirestore.collection(`organizations/${actor.organizationId}/members`).where('active', '==', true).limit(1000).get()
  return members.docs.filter((member) => ['teacher', 'school_admin'].includes(member.data().role)).map((member) => ({ uid: member.id, displayName: String(member.data().fullName ?? member.data().email ?? 'חבר צוות') }))
})

export const getCycleCatalog = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לצפות בהגדרות המחזור')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const [catalog, courses] = await Promise.all([firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get(), firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get()])
  return { catalog: catalog.exists ? catalog.data() : null, courses: courses.exists ? courses.data()?.courses ?? [] : [] }
})

export const getInstructorWorkspace = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.roles.includes('course_instructor')) throw new HttpsError('permission-denied', 'המסך זמין למנחי קורסים בלבד')
  const cycleId = requiredString(inputRecord(request.data), 'cycleId')
  const [cycleSnapshot, catalogSnapshot, workflowSnapshot, formSnapshot] = await Promise.all([
    firestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(workflowDocumentPath(actor.organizationId, cycleId)).get(),
    firestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get(),
  ])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  if (!cycle) throw new HttpsError('not-found', 'מחזור השיבוץ לא נמצא')
  const courses = ((catalogSnapshot.data()?.courses ?? []) as Course[]).filter((course) => course.instructorIds.includes(actor.uid))
  const formDesign = (formSnapshot.data() as CycleCatalogSnapshot | undefined)?.formDesign
  const workflow = workflowSnapshot.data() as WorkflowState | undefined
  const publishedAssignments = workflow?.assignmentRun?.publishedAt ? workflow.assignmentRun.assignments : []
  return {
    cycle: { schoolYear: cycle.schoolYear, termLabel: cycle.termLabel, status: cycle.status },
    documentUrl: courses.length ? formDesign?.documentUrl : undefined,
    hasWordDocument: Boolean(courses.length && formDesign?.documentStoragePath),
    courses: courses.map((course) => ({ id: course.id, label: course.label, description: course.description, subjectArea: course.subjectArea, students: publishedAssignments.filter((assignment) => assignment.courseId === course.id).map((assignment) => [assignment.studentLabel ?? 'תלמיד', assignment.studentClassLabel].filter(Boolean).join(' · ')) })),
  }
})

export const getChoiceContext = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request, 'read')
    const data = inputRecord(request.data)
    return await service.getChoiceContext(actor, requiredString(data, 'cycleId'))
  } catch (error) { return mapError(error) }
})

export const listMySubmissions = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request, 'read')
    const data = inputRecord(request.data)
    return await service.listMySubmissions(actor, requiredString(data, 'cycleId'))
  } catch (error) { return mapError(error) }
})

export const transitionCycle = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request)
    const data = inputRecord(request.data)
    const to = requiredString(data, 'to')
    if (!cycleStatuses.includes(to as (typeof cycleStatuses)[number])) throw new HttpsError('invalid-argument', 'מצב המחזור אינו תקין')
    return await service.transitionCycle(actor, {
      organizationId: actor.organizationId,
      cycleId: requiredString(data, 'cycleId'),
      expectedVersion: requiredInteger(data, 'expectedVersion'),
      to: to as (typeof cycleStatuses)[number],
      reason: requiredString(data, 'reason'),
      occurredAt: new Date().toISOString(),
      idempotencyKey: requiredString(data, 'idempotencyKey'),
      auditEventId: randomUUID(),
    })
  } catch (error) { return mapError(error) }
})

export const savePreferenceDraft = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request)
    const data = inputRecord(request.data)
    const cycleId = requiredString(data, 'cycleId')
    const occurredAt = new Date().toISOString()
    const draft: PreferenceSubmission = {
      id: `draft-${cycleId}-${actor.uid}`,
      organizationId: actor.organizationId,
      cycleId,
      studentId: actor.uid,
      submissionVersion: 0,
      status: 'draft',
      source: 'nativ_app',
      catalogSnapshot: [],
      preferences: parsePreferences(data.preferences),
      version: 0,
      createdAt: occurredAt,
      createdBy: actor.uid,
      updatedAt: occurredAt,
      updatedBy: actor.uid,
    }
    return await service.saveDraft(actor, {
      organizationId: actor.organizationId,
      cycleId,
      studentId: actor.uid,
      draft,
      expectedVersion: requiredInteger(data, 'expectedVersion'),
      occurredAt,
      idempotencyKey: requiredString(data, 'idempotencyKey'),
      auditEventId: randomUUID(),
    })
  } catch (error) { return mapError(error) }
})

export const submitPreferences = onCall(callableOptions, async (request) => {
  try {
    const actor = await actorFromRequest(request)
    const data = inputRecord(request.data)
    const cycleId = requiredString(data, 'cycleId')
    const submissionVersion = requiredInteger(data, 'submissionVersion')
    return await service.submitPreferences(actor, {
      organizationId: actor.organizationId,
      cycleId,
      studentId: actor.uid,
      draftId: `draft-${cycleId}-${actor.uid}`,
      expectedDraftVersion: requiredInteger(data, 'expectedDraftVersion'),
      submittedSubmissionId: `submission-${cycleId}-${actor.uid}-v${submissionVersion}`,
      submissionVersion,
      occurredAt: new Date().toISOString(),
      idempotencyKey: requiredString(data, 'idempotencyKey'),
      auditEventId: randomUUID(),
    })
  } catch (error) { return mapError(error) }
})

export const listAuditEvents = onCall(callableOptions, async (request) => {
  try { return await service.listAuditEvents(await actorFromRequest(request, 'read')) }
  catch (error) { return mapError(error) }
})

const demoAccounts = [
  {
    label: 'מנהל גישה', email: 'access@nativ.demo', password: 'NativDemo!2026',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['access_manager'], capabilities: ['nativ.access.manage'] },
  },
  {
    label: 'רכז שיבוץ', email: 'coordinator@nativ.demo', password: 'NativDemo!2026',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['placement_coordinator', 'appeal_reviewer'], capabilities: ['nativ.assignment.view', 'nativ.assignment.manage', 'nativ.assignment.publish', 'nativ.ai.review', 'nativ.appeal.review', 'nativ.appeal.decide', 'nativ.capacity.override.approve', 'nativ.audit.view'] },
  },
  {
    label: 'תלמיד', email: 'student@nativ.demo', password: 'NativDemo!2026', uid: 'student-demo-001',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['student'], capabilities: [], classId: 'class-demo-7a', classLabel: 'ז׳1' },
  },
  {
    label: 'בודקת ערעורים', email: 'appeals@nativ.demo', password: 'NativDemo!2026',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['appeal_reviewer'], capabilities: ['nativ.assignment.view', 'nativ.appeal.review'] },
  },
  {
    label: 'מזכירות', email: 'secretary@nativ.demo', password: 'NativDemo!2026',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['secretary'], capabilities: [] },
  },
  {
    label: 'מנחה קורס', email: 'instructor@nativ.demo', password: 'NativDemo!2026', uid: 'teacher-course-theater',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['course_instructor'], capabilities: [] },
  },
  {
    label: 'מנחה מוזיקה', email: 'music-instructor@nativ.demo', password: 'NativDemo!2026', uid: 'teacher-course-music',
    claims: { organizationId: demoCycle.organizationId, active: true, roles: ['course_instructor'], capabilities: [] },
  },
] as const

export const seedDemoEnvironment = onCall(callableOptions, async () => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') throw new HttpsError('failed-precondition', 'הפעולה זמינה באמולטור בלבד')
  const auth = getAuth()
  for (const account of demoAccounts) {
    let user
    try {
      user = await auth.getUserByEmail(account.email)
    } catch (error: unknown) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'auth/user-not-found') throw error
      try {
        user = await auth.createUser({ email: account.email, password: account.password, displayName: account.label, ...('uid' in account ? { uid: account.uid } : {}) })
      } catch (createError: unknown) {
        if (typeof createError !== 'object' || createError === null || !('code' in createError) || !['auth/email-already-exists', 'auth/uid-already-exists'].includes(String(createError.code))) throw createError
        user = await auth.getUserByEmail(account.email)
      }
    }
    await auth.setCustomUserClaims(user.uid, account.claims)
  }
  const cycleReference = firestore.doc(cycleDocumentPath(demoCycle.organizationId, demoCycle.id))
  const catalogReference = firestore.doc(catalogSnapshotDocumentPath(demoCycle.organizationId, demoCycle.id))
  const courseCatalogReference = firestore.doc(courseCatalogDocumentPath(demoCycle.organizationId, demoCycle.id))
  await firestore.runTransaction(async (transaction) => {
    const [cycleSnapshot, catalogSnapshot, courseCatalogSnapshot] = await transaction.getAll(cycleReference, catalogReference, courseCatalogReference)
    if (!cycleSnapshot.exists) transaction.create(cycleReference, demoCycle)
    if (!catalogSnapshot.exists) transaction.create(catalogReference, demoCatalogSnapshot)
    if (!courseCatalogSnapshot.exists) transaction.create(courseCatalogReference, { cycleId: demoCycle.id, organizationId: demoCycle.organizationId, courses: demoCourses })
  })
  return { cycleId: demoCycle.id, accounts: demoAccounts.map(({ label, email, password }) => ({ label, email, password })) }
})

export { previewResultDelivery, sendResultDelivery } from './resultDelivery'
export { previewAssignmentChangeDelivery, sendAssignmentChangeDelivery } from './assignmentChangeDelivery'
export { listOperationalIncidents } from './operationalIncidents'
