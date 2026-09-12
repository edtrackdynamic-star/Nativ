import { createHash } from 'node:crypto'
import nodemailer from 'nodemailer'
import { FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { canonicalEmail, deliverOnce, recipientAllowed, renderMail, type MailJob } from '../../server/mail/delivery'
import { FirestoreDeliveryStore } from '../../server/mail/FirestoreDeliveryStore'
import { coreFirestore, nativFirestore } from './firebase'
import { subscriptionAccess } from './request'

const smtpSecret = defineSecret('EDTRACK_SMTP_CONFIG')
const key = (value: string) => createHash('sha256').update(value).digest('hex')
const segment = (value: string) => Boolean(value) && value.length <= 200 && !value.includes('/') && value !== '.' && value !== '..'

function smtpTransport() {
  const config = JSON.parse(smtpSecret.value()) as Record<string, unknown>
  if (!config.host || !config.user || !config.pass || !config.from || ![465, 587].includes(Number(config.port))) throw new Error('mail_configuration_invalid')
  return {
    from: String(config.from),
    transport: nodemailer.createTransport({ host: String(config.host), port: Number(config.port), secure: Number(config.port) === 465, requireTLS: Number(config.port) === 587, auth: { user: String(config.user), pass: String(config.pass) }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true }),
  }
}

async function organizationIsActive(organizationId: string): Promise<boolean> {
  const [organization, subscription] = await Promise.all([
    coreFirestore.doc(`organizations/${organizationId}`).get(),
    coreFirestore.doc(`organizations/${organizationId}/productSubscriptions/nativ`).get(),
  ])
  return organization.data()?.active === true && subscriptionAccess(subscription.data()) === 'full'
}

async function recipient(organizationId: string, uid: string, audience: MailJob['audience']): Promise<string | null> {
  if (!segment(uid)) return null
  const [member, access] = await Promise.all([
    coreFirestore.doc(`organizations/${organizationId}/members/${uid}`).get(),
    nativFirestore.doc(`organizations/${organizationId}/accessAssignments/${uid}`).get(),
  ])
  const data = member.data(); const assignment = access.data()
  if (!recipientAllowed(audience, data, assignment)) return null
  return canonicalEmail(data?.primaryEmail) ?? canonicalEmail(data?.email)
}

export const deliverNativMail = onDocumentCreated({ document: 'organizations/{organizationId}/mailEvents/{eventId}', database: 'nativ', region: 'europe-west1', secrets: [smtpSecret], retry: true, timeoutSeconds: 540, maxInstances: 2, concurrency: 1 }, async (event) => {
  // Never connect to SMTP or read its secret from emulator/test events.
  if (process.env.FUNCTIONS_EMULATOR === 'true' || !event.data) return
  const { organizationId } = event.params
  const reference = event.data.ref
  const jobs = event.data.data().jobs as MailJob[]
  if (!segment(organizationId) || !Array.isArray(jobs) || jobs.some((job) => !job || typeof job.notificationId !== 'string' || typeof job.studentId !== 'string' || !segment(job.notificationId) || !segment(job.studentId) || !['student', 'secretary','staff'].includes(job.audience) || (job.audience==='staff' && (!job.recipientId || !segment(job.recipientId))) || (job.recipientIds && (!Array.isArray(job.recipientIds) || job.recipientIds.some(uid=>typeof uid!=='string'||!segment(uid)))))) {
    await reference.update({ status: 'failed', errorCode: 'mail_event_invalid' }); return
  }
  const attempt = await nativFirestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (['completed', 'failed'].includes(String(snapshot.data()?.status))) return 0
    const count = Number(snapshot.data()?.attempts ?? 0) + 1
    transaction.update(reference, { attempts: count, status: count > 5 ? 'failed' : 'processing', updatedAt: FieldValue.serverTimestamp() })
    return count > 5 ? 0 : count
  })
  if (!attempt) return
  if (!await organizationIsActive(organizationId)) {
    await reference.update({ status: 'failed', errorCode: 'organization_or_subscription_inactive' }); return
  }
  const { transport, from } = smtpTransport()
  // Authentication probe only; it sends no email. Safe to retry before claims.
  try { await transport.verify() }
  catch { throw new Error('smtp_connection_failed') }
  const store = new FirestoreDeliveryStore(nativFirestore, `${reference.path}/receipts`)
  const jobStatuses: string[] = []
  for (const job of jobs) {
    const statusReference = nativFirestore.doc(`organizations/${organizationId}/mailStatuses/${job.notificationId}`)
    // Freeze recipients once: replayed events must not acquire new recipients.
    let roster = (await statusReference.get()).data()?.recipientIds as string[] | undefined
    if (!roster) {
      const candidates = job.recipientIds ?? (job.audience === 'staff' ? [job.recipientId!] : job.audience === 'student' ? [job.studentId] : (await nativFirestore.collection(`organizations/${organizationId}/accessAssignments`).where('roles', 'array-contains', 'secretary').get()).docs.filter((doc) => doc.data().active === true).map((doc) => doc.id))
      roster = await nativFirestore.runTransaction(async (transaction) => {
        const existing = await transaction.get(statusReference)
        if (existing.exists) return existing.data()!.recipientIds as string[]
        transaction.create(statusReference, { status: 'queued', recipientIds: candidates, eventId: event.params.eventId, updatedAt: FieldValue.serverTimestamp() })
        return candidates
      })
    }
    let student = { name: '', classLabel: '' }
    if (job.audience !== 'student' && !job.results?.length) {
      const [member, profile] = await Promise.all([coreFirestore.doc(`organizations/${organizationId}/members/${job.studentId}`).get(), coreFirestore.doc(`organizations/${organizationId}/students/${job.studentId}`).get()])
      const classId = String(profile.data()?.classId ?? member.data()?.classIds?.[0] ?? '')
      const classRecord = segment(classId) ? await coreFirestore.doc(`organizations/${organizationId}/classes/${classId}`).get() : null
      student = { name: String(member.data()?.fullName ?? 'לא צוין'), classLabel: String(classRecord?.data()?.name ?? profile.data()?.className ?? 'לא צוינה') }
    }
    const statuses: string[] = []
    for (const uid of roster) {
      const receiptId = key(`${job.notificationId}:${uid}`)
      // Recheck membership, product role and subscription immediately before SMTP.
      if(job.audience==='staff'){
        const access=(await nativFirestore.doc(`organizations/${organizationId}/accessAssignments/${uid}`).get()).data()
        if(!access?.roles?.some((role:string)=>['secretary','placement_coordinator'].includes(role))){
          const catalog=(await nativFirestore.doc(`organizations/${organizationId}/nativCourseCatalogs/${event.data.data().cycleId}`).get()).data()
          if(!(job.results?.map(row=>row.courseId)??[job.courseId]).every(courseId=>catalog?.courses?.some((course:{id:string;instructorIds:string[]})=>course.id===courseId && course.instructorIds.includes(uid)))){statuses.push('blocked');continue}
        }
      }
      const address = await recipient(organizationId, uid, job.audience)
      if (!address || !await organizationIsActive(organizationId)) { statuses.push('blocked'); continue }
      const content = renderMail(job, student)
      await deliverOnce(store, receiptId, async () => {
        const sent = await transport.sendMail({ from, to: address, subject: content.subject, text: content.text, messageId: `<nativ-${receiptId}@edtrack-nativ.web.app>` })
        if (!sent.accepted.length || sent.rejected.length) throw new Error('recipient_not_accepted')
      })
      statuses.push(String((await nativFirestore.doc(`${reference.path}/receipts/${receiptId}`).get()).data()?.status ?? 'delivery_unknown'))
    }
    const status = statuses.length && statuses.every((value) => value === 'sent') ? 'sent' : statuses.some((value) => ['sending', 'delivery_unknown'].includes(value)) ? 'delivery_unknown' : 'failed'
    jobStatuses.push(status)
    await statusReference.update({ status, errorCode: status === 'failed' ? 'recipient_unavailable_or_delivery_failed' : null, sentCount: statuses.filter((value) => value === 'sent').length, updatedAt: FieldValue.serverTimestamp() })
  }
  await reference.update({ status: 'completed', deliveryStatus: jobStatuses.every((value) => value === 'sent') ? 'sent' : jobStatuses.some((value) => value === 'delivery_unknown') ? 'delivery_unknown' : 'failed', completedAt: FieldValue.serverTimestamp() })
})
