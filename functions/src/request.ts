import type { CallableRequest } from 'firebase-functions/v2/https'
import { HttpsError } from 'firebase-functions/v2/https'
import { capabilityIds, roleIds, type ActorContext, type CapabilityId, type RoleId } from '../../src/domain/access'
import { coreFirestore, nativFirestore } from './firebase'
import { effectiveProductRoles } from '../../src/domain/userRoles'
import { withCourseInstructorRole } from '../../src/domain/userRoles'
import { hasAssignedCourse } from './instructorAccess'

type CallableAuth = NonNullable<CallableRequest['auth']>

function allowedValues<TValue extends string>(value: unknown, allowed: readonly TValue[]): TValue[] {
  if (!Array.isArray(value)) return []
  const allowedSet = new Set<string>(allowed)
  return value.filter((entry): entry is TValue => typeof entry === 'string' && allowedSet.has(entry))
}

export function actorFromAuth(auth: CallableRequest['auth']): ActorContext {
  if (!auth) throw new HttpsError('unauthenticated', 'נדרשת כניסה למערכת')
  const token: CallableAuth['token'] = auth.token
  const organizationId = token.organizationId
  if (typeof organizationId !== 'string' || !organizationId.trim()) {
    throw new HttpsError('permission-denied', 'לא נמצא שיוך ארגוני פעיל')
  }
  if (token.active === false) throw new HttpsError('permission-denied', 'הגישה למשתמש הושעתה')
  return {
    uid: auth.uid,
    organizationId,
    roles: allowedValues<RoleId>(token.roles, roleIds),
    capabilities: allowedValues<CapabilityId>(token.capabilities, capabilityIds),
  }
}

type AccessMode = 'full' | 'read_only'

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('toMillis' in value) || typeof value.toMillis !== 'function') return null
  return value.toMillis()
}

export function subscriptionAccess(data: Record<string, unknown> | undefined, now = Date.now()): AccessMode | null {
  if (!data) return null
  const status = String(data.commercialStatus ?? '')
  if (!['trial', 'active'].includes(status)) return null
  const endsAt = timestampMillis(data.endsAt)
  if (!endsAt || now <= endsAt) return 'full'
  const graceEndsAt = timestampMillis(data.graceEndsAt)
  if (graceEndsAt && now <= graceEndsAt) return 'full'
  const readOnlyUntil = timestampMillis(data.readOnlyUntil)
  return readOnlyUntil && now <= readOnlyUntil ? 'read_only' : null
}

export interface ResolvedActor extends ActorContext {
  organizationName: string
  organizationLogoPath: string
  accessMode: AccessMode
  coreRole: string
  displayName: string
  email: string
}

export async function actorFromRequest(request: CallableRequest, operation: 'read' | 'write' = 'write'): Promise<ResolvedActor> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const actor = actorFromAuth(request.auth)
    const coreRole = actor.roles.includes('student') ? 'student' : 'teacher'
    const roles = coreRole === 'student' ? effectiveProductRoles(coreRole, actor.roles) : withCourseInstructorRole(effectiveProductRoles(coreRole, actor.roles), await hasAssignedCourse(actor.organizationId, actor.uid))
    return { ...actor, studentClassId: String(request.auth?.token.classId ?? ''), organizationName: 'בית ספר לדוגמה', organizationLogoPath: '', roles, capabilities: [...new Set(roles.flatMap((role) => roleCapabilityMap[role]))], accessMode: 'full', coreRole, displayName: '', email: String(request.auth?.token.email ?? '') }
  }
  if (!request.auth) throw new HttpsError('unauthenticated', 'נדרשת כניסה למערכת')
  const organizationId = String(request.auth.token.organizationId ?? '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{2,64}$/.test(organizationId)) throw new HttpsError('permission-denied', 'לא נמצא שיוך ארגוני פעיל')
  const [organization, membership, subscription, productAccess] = await Promise.all([
    coreFirestore.doc(`organizations/${organizationId}`).get(),
    coreFirestore.doc(`organizations/${organizationId}/members/${request.auth.uid}`).get(),
    coreFirestore.doc(`organizations/${organizationId}/productSubscriptions/nativ`).get(),
    nativFirestore.doc(`organizations/${organizationId}/accessAssignments/${request.auth.uid}`).get(),
  ])
  const organizationData = organization.data()
  const membershipData = membership.data()
  if (!organization.exists || organizationData?.active !== true || !membership.exists || membershipData?.active !== true) {
    throw new HttpsError('permission-denied', 'לא נמצאה חברות פעילה בארגון')
  }
  const accessMode = subscriptionAccess(subscription.data())
  if (!accessMode || (operation === 'write' && accessMode !== 'full')) {
    throw new HttpsError('permission-denied', operation === 'write' ? 'מנוי נתיב אינו מאפשר שינוי נתונים' : `אין מנוי פעיל לנתיב בבית הספר ${String(organizationData?.name ?? organizationId)}. אפשר לבחור בית ספר אחר או לפנות למנהל בית הספר.`)
  }
  const accessData = productAccess.data()
  const assignedRoles = accessData?.active === false ? [] : allowedValues<RoleId>(accessData?.roles, roleIds)
  const coreRole = String(membershipData?.role ?? '')
  const baseRoles = effectiveProductRoles(coreRole, assignedRoles, accessData?.active !== false)
  const roles = ['teacher', 'school_admin'].includes(coreRole) && accessData?.active !== false
    ? withCourseInstructorRole(baseRoles, await hasAssignedCourse(organizationId, request.auth.uid)) : baseRoles
  const capabilities = [...new Set(roles.flatMap((role) => roleCapabilityMap[role]))]
  const studentProfile = roles.includes('student') ? await coreFirestore.doc(`organizations/${organizationId}/students/${request.auth.uid}`).get() : undefined
  return {
    studentClassId: String(studentProfile?.data()?.classId ?? membershipData?.classIds?.[0] ?? ''),
    uid: request.auth.uid,
    organizationId,
    organizationName: String(organizationData?.name ?? ''),
    organizationLogoPath: String(organizationData?.branding?.logoPath ?? `organizations/${organizationId}/branding/logo.png`),
    roles,
    capabilities,
    accessMode,
    coreRole,
    displayName: String(membershipData?.fullName ?? request.auth.token.name ?? ''),
    email: String(membershipData?.email ?? request.auth.token.email ?? ''),
  }
}

export const roleCapabilityMap: Record<RoleId, CapabilityId[]> = {
  access_manager: ['nativ.access.manage'],
  placement_coordinator: ['nativ.assignment.view', 'nativ.assignment.manage', 'nativ.assignment.publish', 'nativ.ai.review', 'nativ.appeal.review', 'nativ.appeal.decide', 'nativ.capacity.override.approve', 'nativ.audit.view'],
  appeal_reviewer: ['nativ.assignment.view', 'nativ.appeal.review'],
  secretary: [],
  course_instructor: [],
  student: [],
}

export function inputRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'נדרש אובייקט קלט')
  }
  return data as Record<string, unknown>
}

export function requiredString(data: Record<string, unknown>, field: string): string {
  const value = data[field]
  if (typeof value !== 'string' || !value.trim()) throw new HttpsError('invalid-argument', `חסר שדה ${field}`)
  return value.trim()
}

export function requiredInteger(data: Record<string, unknown>, field: string): number {
  const value = data[field]
  if (!Number.isInteger(value) || Number(value) < 0) throw new HttpsError('invalid-argument', `השדה ${field} חייב להיות מספר שלם ולא שלילי`)
  return Number(value)
}
