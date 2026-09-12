import { createHash } from 'node:crypto'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { Firestore } from 'firebase-admin/firestore'
import { coreFirestore, nativFirestore, callableOptions } from './firebase'
import { actorFromRequest } from './request'
import type { MailJob } from '../../server/mail/delivery'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const path = (organizationId: string, id: string) => `organizations/${organizationId}/operationalIncidents/${id}`

interface IncidentStores { core: Firestore; nativ: Firestore }
async function managerIds(organizationId: string, stores: IncidentStores): Promise<string[]> {
  const [members, access, platform] = await Promise.all([
    stores.core.collection(`organizations/${organizationId}/members`).where('role', '==', 'school_admin').get(),
    stores.nativ.collection(`organizations/${organizationId}/accessAssignments`).where('roles', 'array-contains', 'access_manager').get(),
    stores.core.collection('platformAdmins').where('active', '==', true).get(),
  ])
  const ids = new Set<string>([...members.docs.filter((entry) => entry.data().active === true).map((entry) => entry.id), ...access.docs.filter((entry) => entry.data().active === true).map((entry) => entry.id), ...platform.docs.map((entry) => entry.id)])
  return [...ids]
}

export async function reportOperationalFailure(organizationId: string, action: string, category: string, stores: IncidentStores = { core: coreFirestore, nativ: nativFirestore }): Promise<string> {
  const now = new Date()
  const window = Math.floor(now.getTime() / (15 * 60 * 1000))
  const id = hash(`${organizationId}:${action}:${category}:${window}`).slice(0, 32)
  const incidentRef = stores.nativ.doc(path(organizationId, id))
  const eventRef = stores.nativ.doc(`organizations/${organizationId}/mailEvents/incident-${id}`)
  const recipients = await managerIds(organizationId, stores)
  await stores.nativ.runTransaction(async (transaction) => {
    const existing = await transaction.get(incidentRef)
    if (existing.exists) { transaction.update(incidentRef, { lastSeenAt: now.toISOString(), occurrences: Number(existing.data()?.occurrences ?? 1) + 1 }); return }
    transaction.create(incidentRef, { id, organizationId, action, category, occurredAt: now.toISOString(), lastSeenAt: now.toISOString(), occurrences: 1, notificationEventId: eventRef.id, status: recipients.length ? 'queued' : 'no_recipient' })
    if (recipients.length) {
      const job: MailJob = { notificationId: `incident-${id}`, audience: 'incident', studentId: 'system', recipientIds: recipients, clusterLabel: '', afterCourseLabel: '', occurredAt: now.toISOString(), incident: { id, action, category } }
      transaction.create(eventRef, { organizationId, cycleId: 'system', jobs: [job], status: 'queued', attempts: 0, createdAt: now.toISOString(), kind: 'incident' })
    }
  })
  await stores.core.doc(`nativOperationalIncidents/${id}`).set({ id, organizationId, action, category, occurredAt: now.toISOString(), lastSeenAt: now.toISOString(), notificationEventId: eventRef.id }, { merge: true }).catch(() => undefined)
  return id
}

export async function operationalError(organizationId: string | undefined, action: string, error: unknown): Promise<never> {
  if (error instanceof HttpsError && ['invalid-argument', 'permission-denied', 'unauthenticated', 'failed-precondition', 'aborted', 'not-found', 'already-exists'].includes(error.code)) throw error
  let id = ''
  if (organizationId) {
    try { id = await reportOperationalFailure(organizationId, action, 'server_failure') }
    catch { /* The original failure remains the primary error. */ }
  }
  throw new HttpsError('internal', `אירעה תקלה מערכתית והפעולה לא הושלמה. רעננו ובדקו את המצב לפני ניסיון נוסף.${id ? ` מזהה אירוע: ${id}.` : ''} אם התקלה נמשכת, פנו למנהל הגישה.`)
}

export const listOperationalIncidents = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.roles.includes('access_manager') && actor.coreRole !== 'school_admin') throw new HttpsError('permission-denied', 'האירועים זמינים למנהל גישה בלבד')
  const snapshot = await nativFirestore.collection(`organizations/${actor.organizationId}/operationalIncidents`).orderBy('occurredAt', 'desc').limit(30).get()
  return snapshot.docs.map((entry) => entry.data())
})
