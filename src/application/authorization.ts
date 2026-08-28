import { hasCapability, type ActorContext, type CapabilityId } from '../domain/access'
import { AuthorizationError } from './errors'

export function assertOrganizationScope(actor: ActorContext, organizationId: string): void {
  if (actor.organizationId !== organizationId) {
    throw new AuthorizationError('אין הרשאה לפעול בארגון אחר')
  }
}

export function assertCapability(actor: ActorContext, capability: CapabilityId): void {
  if (!hasCapability(actor, capability)) {
    throw new AuthorizationError()
  }
}

export function assertStudentSelfOrManager(actor: ActorContext, studentId: string): void {
  if (actor.uid !== studentId && !hasCapability(actor, 'nativ.assignment.manage')) {
    throw new AuthorizationError('אין הרשאה לשמור טופס של תלמיד אחר')
  }
}
