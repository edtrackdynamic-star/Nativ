import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { capabilityIds, roleIds, type CapabilityId, type RoleId } from '../../src/domain/access'
import { actorFromAuth, inputRecord, requiredString } from './request'
import { auditEventDocumentPath } from '../../server/firestore/paths'

if (!getApps().length) initializeApp()
const callableOptions = { region: 'europe-west1' as const }

export interface AccessUserSummary { uid: string; email?: string; displayName?: string; roles: RoleId[]; capabilities: CapabilityId[]; active: boolean }

const roleCapabilities: Record<RoleId, CapabilityId[]> = {
  access_manager: ['nativ.access.manage'],
  placement_coordinator: ['nativ.assignment.view', 'nativ.assignment.manage', 'nativ.assignment.publish', 'nativ.ai.review', 'nativ.appeal.review', 'nativ.appeal.decide', 'nativ.audit.view'],
  appeal_reviewer: ['nativ.assignment.view', 'nativ.appeal.review'],
  secretary: [], course_instructor: [], student: [],
}

function requireAccessManager(requestAuth: Parameters<typeof actorFromAuth>[0]) {
  const actor = actorFromAuth(requestAuth)
  if (!actor.capabilities.includes('nativ.access.manage')) throw new HttpsError('permission-denied', 'אין הרשאת ניהול גישה')
  return actor
}

export const listAccessUsers = onCall(callableOptions, async (request) => {
  const actor = requireAccessManager(request.auth)
  const result = await getAuth().listUsers(1000)
  return result.users.filter((user) => user.customClaims?.organizationId === actor.organizationId).map((user): AccessUserSummary => ({ uid: user.uid, email: user.email, displayName: user.displayName, roles: Array.isArray(user.customClaims?.roles) ? user.customClaims.roles.filter((role): role is RoleId => typeof role === 'string' && roleIds.includes(role as RoleId)) : [], capabilities: Array.isArray(user.customClaims?.capabilities) ? user.customClaims.capabilities.filter((capability): capability is CapabilityId => typeof capability === 'string' && capabilityIds.includes(capability as CapabilityId)) : [], active: user.customClaims?.active === true }))
})

export const setUserAccess = onCall(callableOptions, async (request) => {
  const actor = requireAccessManager(request.auth)
  const data = inputRecord(request.data)
  const uid = requiredString(data, 'uid')
  const roles = Array.isArray(data.roles) ? data.roles.filter((role): role is RoleId => typeof role === 'string' && roleIds.includes(role as RoleId)) : []
  const capabilities = [...new Set(roles.flatMap((role) => roleCapabilities[role]))]
  const user = await getAuth().getUser(uid)
  if (user.customClaims?.organizationId !== actor.organizationId) throw new HttpsError('permission-denied', 'אין הרשאה לשנות משתמש מארגון אחר')
  await getAuth().setCustomUserClaims(uid, { ...user.customClaims, organizationId: actor.organizationId, roles, capabilities, active: data.active !== false })
  const now = new Date().toISOString()
  const auditId = randomUUID()
  await getFirestore().doc(auditEventDocumentPath(actor.organizationId, auditId)).create({ id: auditId, organizationId: actor.organizationId, actorId: actor.uid, occurredAt: now, action: 'access.roles.updated', entityType: 'UserAccess', entityId: uid, reason: `תפקידים קודמים: ${JSON.stringify(user.customClaims?.roles ?? [])}; תפקידים חדשים: ${JSON.stringify(roles)}` })
  return { uid, roles, capabilities, active: data.active !== false }
})
import { randomUUID } from 'node:crypto'
