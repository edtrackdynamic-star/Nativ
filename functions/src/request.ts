import type { CallableRequest } from 'firebase-functions/v2/https'
import { HttpsError } from 'firebase-functions/v2/https'
import { capabilityIds, roleIds, type ActorContext, type CapabilityId, type RoleId } from '../../src/domain/access'

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
