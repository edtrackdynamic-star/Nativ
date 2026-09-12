import { createHash } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { AssignmentChangeRecord, ChangeAudience } from '../../src/domain/assignmentChange'
import type { Course } from '../../src/domain/catalog'
import type { WorkflowState } from '../../src/domain/workflow'
import { canonicalEmail, recipientAllowed, renderMail, type MailJob } from '../../server/mail/delivery'
import { courseCatalogDocumentPath, workflowDocumentPath } from '../../server/firestore/paths'
import { callableOptions, coreFirestore, nativFirestore as db } from './firebase'
import { actorFromRequest, inputRecord, requiredString } from './request'
import { operationalError } from './operationalIncidents'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const audiences: ChangeAudience[] = ['student', 'instructor', 'secretary']
type Request = Parameters<typeof actorFromRequest>[0]
type ChangeLine = NonNullable<MailJob['changeLines']>[number]

async function prepare(request: Request, write = false) {
  const actor = await actorFromRequest(request, write ? 'write' : 'read')
  if (!actor.capabilities.includes('nativ.assignment.publish')) throw new HttpsError('permission-denied', 'אין הרשאה לשליחת עדכוני שיבוץ')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const audience = requiredString(data, 'audience') as ChangeAudience
  if (!audiences.includes(audience)) throw new HttpsError('invalid-argument', 'יש לבחור תלמידים, מורים או מזכירות')
  const changesRef = db.collection(`organizations/${actor.organizationId}/assignmentChanges/${cycleId}/entries`)
  const [workflowDoc, catalogDoc, changeDocs] = await Promise.all([
    db.doc(workflowDocumentPath(actor.organizationId, cycleId)).get(),
    db.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
    changesRef.get(),
  ])
  const workflow = workflowDoc.data() as WorkflowState | undefined
  if (!workflow?.assignmentRun?.publishedAt) throw new HttpsError('failed-precondition', 'יש לפרסם שיבוץ לפני שליחת עדכונים')
  const courses = (catalogDoc.data()?.courses ?? []) as Course[]
  const allChanges = changeDocs.docs.map((entry) => entry.data() as AssignmentChangeRecord).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  const selectedId = typeof data.changeId === 'string' && data.changeId ? data.changeId : undefined
  if (selectedId && !allChanges.some((entry) => entry.id === selectedId)) throw new HttpsError('not-found', 'השינוי לא נמצא; רעננו את המחזור')
  const autoEvents = audience === 'secretary' && allChanges.length ? await db.getAll(...allChanges.map((entry) => db.doc(`organizations/${actor.organizationId}/mailEvents/${entry.secretaryAutoEventId}`))) : []
  const autoStatuses = audience === 'secretary' && allChanges.length ? await db.getAll(...allChanges.map((entry) => db.doc(`organizations/${actor.organizationId}/mailStatuses/${entry.secretaryAutoEventId}`))) : []
  let autoHandled = 0
  let needsReview = 0
  const changes = allChanges.filter((entry, index) => {
    if (entry.dispatches?.[audience] || (selectedId && entry.id !== selectedId)) return false
    if (audience !== 'secretary') return true
    const event = autoEvents[index]?.data()
    const status = autoStatuses[index]?.data()
    if (event?.status === 'failed' || (event?.status === 'completed' && event?.deliveryStatus === 'failed')) {
      if (Number(status?.sentCount ?? 0) === 0) return true
      needsReview++
      return false
    }
    if (event?.deliveryStatus === 'delivery_unknown' || status?.status === 'delivery_unknown') needsReview++
    else autoHandled++
    return false
  })
  const uidLines = new Map<string, { lines: ChangeLine[]; relatedCourseIds: Set<string> }>()
  const add = (uid: string, line: ChangeLine, courseId?: string) => {
    const existing = uidLines.get(uid) ?? { lines: [], relatedCourseIds: new Set<string>() }
    existing.lines.push(line)
    if (courseId) existing.relatedCourseIds.add(courseId)
    uidLines.set(uid, existing)
  }
  for (const change of changes) {
    const base = { studentName: change.studentName, classLabel: change.classLabel, clusterLabel: change.clusterLabel, beforeCourseLabel: change.beforeCourseLabel, afterCourseLabel: change.afterCourseLabel }
    if (audience === 'student') add(change.studentId, { ...base, direction: 'student' })
    if (audience === 'instructor') {
      const before = courses.find((entry) => entry.id === change.beforeCourseId)?.instructorIds ?? []
      const after = courses.find((entry) => entry.id === change.afterCourseId)?.instructorIds ?? []
      for (const uid of new Set([...before, ...after])) {
        const inBefore = before.includes(uid), inAfter = after.includes(uid)
        add(uid, { ...base, direction: inBefore && inAfter ? 'moved' : inBefore ? 'left' : 'joined' }, inBefore ? change.beforeCourseId : change.afterCourseId)
        if (inBefore && inAfter) uidLines.get(uid)?.relatedCourseIds.add(change.afterCourseId)
      }
    }
  }
  if (audience === 'secretary' && changes.length) {
    const accessDocs = await db.collection(`organizations/${actor.organizationId}/accessAssignments`).where('roles', 'array-contains', 'secretary').get()
    for (const entry of accessDocs.docs.filter((row) => row.data().active === true)) for (const change of changes) add(entry.id, { studentName: change.studentName, classLabel: change.classLabel, clusterLabel: change.clusterLabel, beforeCourseLabel: change.beforeCourseLabel, afterCourseLabel: change.afterCourseLabel, direction: 'secretary' })
  }
  const ids = [...uidLines.keys()]
  const members = new Map<string, Record<string, unknown>>(), access = new Map<string, Record<string, unknown>>()
  if (ids.length && process.env.FUNCTIONS_EMULATOR === 'true') {
    for (const uid of ids) {
      try {
        const user = await getAuth().getUser(uid)
        members.set(uid, { active: user.customClaims?.active === true, role: user.customClaims?.roles?.includes('student') ? 'student' : 'teacher', fullName: user.displayName ?? user.email, email: user.email })
        access.set(uid, { active: true, roles: user.customClaims?.roles ?? [] })
      } catch { /* missing users remain skipped */ }
    }
  } else if (ids.length) {
    const [memberDocs, accessDocs] = await Promise.all([
      coreFirestore.getAll(...ids.map((uid) => coreFirestore.doc(`organizations/${actor.organizationId}/members/${uid}`))),
      db.getAll(...ids.map((uid) => db.doc(`organizations/${actor.organizationId}/accessAssignments/${uid}`))),
    ])
    ids.forEach((uid, index) => { if (memberDocs[index].exists) members.set(uid, memberDocs[index].data()!); if (accessDocs[index].exists) access.set(uid, accessDocs[index].data()!) })
  }
  const signature = hash(JSON.stringify([audience, changes.map((entry) => entry.id), workflow.version]))
  const dispatchId = `${cycleId}-${audience}-${signature.slice(0, 32)}`
  const jobs: MailJob[] = [], messages: Array<{ name: string; email: string; subject: string; text: string }> = []
  let skipped = 0
  for (const [uid, payload] of uidLines) {
    const member = members.get(uid), email = canonicalEmail(member?.primaryEmail) ?? canonicalEmail(member?.email)
    const mailAudience: MailJob['audience'] = audience === 'instructor' ? 'instructor_change' : audience
    if (!email || !recipientAllowed(mailAudience, member, access.get(uid))) { skipped++; continue }
    const job: MailJob = { notificationId: hash(`${dispatchId}:${uid}`), audience: mailAudience, recipientId: uid, recipientIds: [uid], studentId: audience === 'student' ? uid : changes[0].studentId, clusterLabel: '', afterCourseLabel: '', occurredAt: changes[changes.length - 1].occurredAt, changeLines: payload.lines, ...(audience === 'instructor' ? { relatedCourseIds: [...payload.relatedCourseIds] } : {}) }
    if (Buffer.byteLength(JSON.stringify(job)) > 650000) throw new HttpsError('failed-precondition', 'עדכון השיבוץ גדול מדי למשלוח; פנו למנהל המערכת')
    const content = renderMail(job, { name: '', classLabel: '' })
    jobs.push(job)
    messages.push({ name: String(member?.fullName ?? 'נמען'), email, ...content })
  }
  const recipientSignature = hash(JSON.stringify(messages.map((message, index) => [jobs[index].recipientId, message.email, message.subject, message.text]).sort()))
  const dispatchRef = db.doc(`organizations/${actor.organizationId}/changeDispatches/${dispatchId}`)
  const previousDispatchIds = [...new Set(allChanges.map((entry) => entry.dispatches?.[audience]).filter((id): id is string => Boolean(id)))]
  const previousDispatches = previousDispatchIds.length ? await db.getAll(...previousDispatchIds.map((id) => db.doc(`organizations/${actor.organizationId}/changeDispatches/${id}`))) : []
  const notificationIds = [...new Set(previousDispatches.flatMap((entry) => (entry.data()?.notificationIds ?? []) as string[]))]
  const statusDocs = notificationIds.length ? await db.getAll(...notificationIds.map((id) => db.doc(`organizations/${actor.organizationId}/mailStatuses/${id}`))) : []
  const delivery = { sent: 0, queued: 0, failed: 0, unknown: 0 }
  for (const entry of statusDocs) {
    const status = String(entry.data()?.status ?? 'queued')
    if (status === 'sent') delivery.sent++
    else if (status === 'failed') delivery.failed++
    else if (status === 'delivery_unknown') delivery.unknown++
    else delivery.queued++
  }
  return { actor, cycleId, audience, workflow, changes, allChanges, signature, recipientSignature, dispatchId, dispatchRef, jobs, messages, skipped, autoHandled, needsReview, delivery }
}

export const previewAssignmentChangeDelivery = onCall(callableOptions, async (request) => {
  try {
    const result = await prepare(request)
    return { signature: result.signature, recipientSignature: result.recipientSignature, version: result.workflow.version, changes: result.changes, messages: result.messages, skipped: result.skipped, autoHandled: result.autoHandled, needsReview: result.needsReview, delivery: result.delivery }
  } catch (error) { return operationalError(String(request.auth?.token.organizationId ?? ''), 'preview_assignment_change_delivery', error) }
})

export const sendAssignmentChangeDelivery = onCall(callableOptions, async (request) => {
  try {
  const result = await prepare(request, true)
  const data = inputRecord(request.data)
  if (data.signature !== result.signature || data.recipientSignature !== result.recipientSignature || data.expectedVersion !== result.workflow.version) throw new HttpsError('aborted', 'השיבוץ או הנמענים השתנו. רעננו את התצוגה המקדימה לפני השליחה')
  if (!result.changes.length) throw new HttpsError('failed-precondition', 'אין שינויים ממתינים למשלוח לקבוצה זו')
  if (result.skipped) throw new HttpsError('failed-precondition', `לא ניתן לשלוח: ${result.skipped} נמענים חסרים כתובת מייל תקינה או גישה פעילה. תקנו את הפרטים באדטרק ובנתיב, רעננו את התצוגה המקדימה ונסו שוב`)
  if (!result.jobs.length) throw new HttpsError('failed-precondition', 'לא נמצאו נמענים פעילים עם כתובת מייל תקינה. תקנו את הכתובות או הגישה ונסו שוב')
  if (result.jobs.length > 3000) throw new HttpsError('failed-precondition', 'רשימת הנמענים גדולה מדי; פנו למנהל המערכת')
  return db.runTransaction(async (transaction) => {
    const workflowRef = db.doc(workflowDocumentPath(result.actor.organizationId, result.cycleId))
    const changeRefs = result.changes.map((change) => db.doc(`organizations/${result.actor.organizationId}/assignmentChanges/${result.cycleId}/entries/${change.id}`))
    const [workflowDoc, dispatchDoc, ...changeDocs] = await transaction.getAll(workflowRef, result.dispatchRef, ...changeRefs)
    if (dispatchDoc.exists) return { alreadyQueued: true }
    if (workflowDoc.data()?.version !== result.workflow.version || changeDocs.some((entry) => !entry.exists || entry.data()?.dispatches?.[result.audience])) throw new HttpsError('aborted', 'השיבוץ או מצב השליחה השתנו. רעננו לפני שליחה')
    const eventIds: string[] = []
    const batches: MailJob[][] = []
    let batch: MailJob[] = [], bytes = 0
    for (const job of result.jobs) {
      const size = Buffer.byteLength(JSON.stringify(job))
      if (batch.length && (batch.length >= 100 || bytes + size > 700000)) { batches.push(batch); batch = []; bytes = 0 }
      batch.push(job); bytes += size
    }
    if (batch.length) batches.push(batch)
    if (batches.length + changeRefs.length + 2 > 450) throw new HttpsError('failed-precondition', 'יש יותר מדי שינויים למשלוח אחד. שלחו עדכונים במנות קטנות יותר או פנו למנהל המערכת')
    for (const [index, jobs] of batches.entries()) {
      const eventId = `${result.dispatchId}-${index}`
      eventIds.push(eventId)
      transaction.create(db.doc(`organizations/${result.actor.organizationId}/mailEvents/${eventId}`), { organizationId: result.actor.organizationId, cycleId: result.cycleId, jobs, status: 'queued', attempts: 0, createdAt: new Date().toISOString(), createdBy: result.actor.uid })
    }
    changeRefs.forEach((reference) => transaction.update(reference, { [`dispatches.${result.audience}`]: result.dispatchId }))
    transaction.create(result.dispatchRef, { audience: result.audience, cycleId: result.cycleId, changeIds: result.changes.map((entry) => entry.id), eventIds, notificationIds: result.jobs.map((entry) => entry.notificationId), createdBy: result.actor.uid, createdAt: new Date().toISOString() })
    transaction.create(db.collection(`organizations/${result.actor.organizationId}/nativAuditEvents`).doc(), { organizationId: result.actor.organizationId, actorId: result.actor.uid, action: `assignment_change.sent.${result.audience}`, entityType: 'AssignmentCycle', entityId: result.cycleId, occurredAt: new Date().toISOString(), reason: `נשלחו ${result.jobs.length} עדכוני שיבוץ ממוקדים` })
    return { alreadyQueued: false }
  })
  } catch (error) { return operationalError(String(request.auth?.token.organizationId ?? ''), 'send_assignment_change_delivery', error) }
})
