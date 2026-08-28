import { randomUUID } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { roleIds, type CapabilityId, type RoleId } from '../../src/domain/access'
import { auditEventDocumentPath } from '../../server/firestore/paths'
import { callableOptions, coreFirestore, nativFirestore } from './firebase'
import { actorFromRequest, inputRecord, requiredString, roleCapabilityMap } from './request'

export interface AccessUserSummary { uid: string; email?: string; displayName?: string; roles: RoleId[]; capabilities: CapabilityId[]; active: boolean; coreRole?: string }

async function requireAccessManager(request: Parameters<typeof actorFromRequest>[0]) {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.access.manage')) throw new HttpsError('permission-denied', 'אין הרשאת ניהול גישה')
  return actor
}

function validRoles(value: unknown): RoleId[] {
  return Array.isArray(value) ? value.filter((role): role is RoleId => typeof role === 'string' && roleIds.includes(role as RoleId)) : []
}

export const getMyNativAccess = onCall(callableOptions, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  return { organizationId: actor.organizationId, roles: actor.roles, capabilities: actor.capabilities, accessMode: actor.accessMode, coreRole: actor.coreRole, displayName: actor.displayName, email: actor.email }
})

export const claimInitialAccessManager = onCall(callableOptions, async (request) => {
  if (process.env.FUNCTIONS_EMULATOR === 'true') throw new HttpsError('failed-precondition', 'הפעולה אינה נדרשת בסביבת ההדגמה')
  const actor = await actorFromRequest(request)
  if (actor.coreRole !== 'school_admin') throw new HttpsError('permission-denied', 'רק מנהל ארגוני יכול להפעיל את מנהל הגישה הראשון')
  const collection = nativFirestore.collection(`organizations/${actor.organizationId}/accessAssignments`)
  const ownReference = collection.doc(actor.uid)
  await nativFirestore.runTransaction(async (transaction) => {
    const existingManagers = await transaction.get(collection.where('roles', 'array-contains', 'access_manager').where('active', '==', true).limit(1))
    const own = await transaction.get(ownReference)
    if (!existingManagers.empty && existingManagers.docs[0]?.id !== actor.uid) throw new HttpsError('already-exists', 'מנהל גישה כבר הוגדר; יש לפנות אליו לקבלת הרשאה')
    const previousRoles = validRoles(own.data()?.roles)
    transaction.set(ownReference, { organizationId: actor.organizationId, uid: actor.uid, roles: [...new Set<RoleId>([...previousRoles, 'access_manager'])], active: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, ...(!own.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}) }, { merge: true })
    transaction.create(nativFirestore.collection(`organizations/${actor.organizationId}/nativAuditEvents`).doc(), { id: randomUUID(), organizationId: actor.organizationId, actorId: actor.uid, occurredAt: new Date().toISOString(), action: 'access.initial_manager.claimed', entityType: 'UserAccess', entityId: actor.uid, reason: 'הפעלה חד-פעמית של מנהל הגישה הראשון' })
  })
  return { activated: true }
})

export const listAccessUsers = onCall(callableOptions, async (request) => {
  const actor = await requireAccessManager(request)
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const result = await getAuth().listUsers(1000)
    return result.users.filter((user) => user.customClaims?.organizationId === actor.organizationId).map((user): AccessUserSummary => {
      const roles = validRoles(user.customClaims?.roles)
      return { uid: user.uid, email: user.email, displayName: user.displayName, roles, capabilities: [...new Set(roles.flatMap((role) => roleCapabilityMap[role]))], active: user.customClaims?.active === true }
    })
  }
  const [members, assignments] = await Promise.all([
    coreFirestore.collection(`organizations/${actor.organizationId}/members`).limit(1000).get(),
    nativFirestore.collection(`organizations/${actor.organizationId}/accessAssignments`).get(),
  ])
  const accessByUid = new Map(assignments.docs.map((entry) => [entry.id, entry.data()]))
  return members.docs.map((member): AccessUserSummary => {
    const memberData = member.data()
    const access = accessByUid.get(member.id)
    const assignedRoles = access?.active === false ? [] : validRoles(access?.roles)
    const roles = memberData.role === 'student' ? [...new Set<RoleId>(['student', ...assignedRoles])] : assignedRoles
    return { uid: member.id, email: String(memberData.email ?? ''), displayName: String(memberData.fullName ?? ''), roles, capabilities: [...new Set(roles.flatMap((role) => roleCapabilityMap[role]))], active: memberData.active === true && access?.active !== false, coreRole: String(memberData.role ?? '') }
  })
})

export const setUserAccess = onCall(callableOptions, async (request) => {
  const actor = await requireAccessManager(request)
  const data = inputRecord(request.data)
  const uid = requiredString(data, 'uid')
  const roles = validRoles(data.roles).filter((role) => role !== 'student')
  const capabilities = [...new Set(roles.flatMap((role) => roleCapabilityMap[role]))]
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const user = await getAuth().getUser(uid)
    if (user.customClaims?.organizationId !== actor.organizationId) throw new HttpsError('permission-denied', 'אין הרשאה לשנות משתמש מארגון אחר')
    await getAuth().setCustomUserClaims(uid, { ...user.customClaims, organizationId: actor.organizationId, roles, capabilities, active: data.active !== false })
    const auditId = randomUUID()
    await nativFirestore.doc(auditEventDocumentPath(actor.organizationId, auditId)).create({ id: auditId, organizationId: actor.organizationId, actorId: actor.uid, occurredAt: new Date().toISOString(), action: 'access.roles.updated', entityType: 'UserAccess', entityId: uid, reason: `תפקידים קודמים: ${JSON.stringify(user.customClaims?.roles ?? [])}; תפקידים חדשים: ${JSON.stringify(roles)}` })
    return { uid, roles, capabilities, active: data.active !== false }
  }
  const membership = await coreFirestore.doc(`organizations/${actor.organizationId}/members/${uid}`).get()
  if (!membership.exists || membership.data()?.active !== true) throw new HttpsError('permission-denied', 'המשתמש אינו חבר פעיל בארגון')
  const reference = nativFirestore.doc(`organizations/${actor.organizationId}/accessAssignments/${uid}`)
  const previous = await reference.get()
  const auditId = randomUUID()
  const batch = nativFirestore.batch()
  batch.set(reference, { organizationId: actor.organizationId, uid, roles, active: data.active !== false, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, ...(!previous.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}) }, { merge: true })
  batch.create(nativFirestore.doc(auditEventDocumentPath(actor.organizationId, auditId)), { id: auditId, organizationId: actor.organizationId, actorId: actor.uid, occurredAt: new Date().toISOString(), action: 'access.roles.updated', entityType: 'UserAccess', entityId: uid, reason: `תפקידים קודמים: ${JSON.stringify(previous.data()?.roles ?? [])}; תפקידים חדשים: ${JSON.stringify(roles)}` })
  await batch.commit()
  return { uid, roles, capabilities, active: data.active !== false }
})
