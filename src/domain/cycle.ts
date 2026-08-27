import { ConcurrentModificationError, DomainValidationError, type AuditEvent, type VersionedEntity } from './types'

export const cycleStatuses = ['draft', 'choice_open', 'choice_closed', 'assignment', 'published', 'appeals', 'closed'] as const
export type CycleStatus = (typeof cycleStatuses)[number]

export interface AssignmentCycle extends VersionedEntity {
  schoolYear: string
  termLabel: string
  status: CycleStatus
  choiceOpensAt?: string
  choiceClosesAt?: string
  publishedAt?: string
  appealWindowSchoolDays: number
  rulesVersion: string
}

const allowedTransitions: Record<CycleStatus, CycleStatus[]> = {
  draft: ['choice_open'],
  choice_open: ['choice_closed'],
  choice_closed: ['assignment'],
  assignment: ['published'],
  published: ['appeals', 'closed'],
  appeals: ['closed'],
  closed: [],
}

export function canTransitionCycle(from: CycleStatus, to: CycleStatus): boolean {
  return allowedTransitions[from].includes(to)
}

export interface CycleTransitionCommand {
  expectedVersion: number
  to: CycleStatus
  actorId: string
  occurredAt: string
  reason: string
  auditEventId: string
}

export function transitionCycle(cycle: AssignmentCycle, command: CycleTransitionCommand): { cycle: AssignmentCycle; auditEvent: AuditEvent } {
  if (cycle.version !== command.expectedVersion) {
    throw new ConcurrentModificationError(command.expectedVersion, cycle.version)
  }
  if (!command.reason.trim()) {
    throw new DomainValidationError([{ code: 'cycle.reason_required', message: 'נדרשת סיבה לשינוי מצב המחזור', path: 'reason', severity: 'error' }])
  }
  if (!canTransitionCycle(cycle.status, command.to)) {
    throw new DomainValidationError([{ code: 'cycle.invalid_transition', message: `לא ניתן לעבור מ-${cycle.status} אל ${command.to}`, path: 'status', severity: 'error' }])
  }

  const nextCycle: AssignmentCycle = {
    ...cycle,
    status: command.to,
    version: cycle.version + 1,
    updatedAt: command.occurredAt,
    updatedBy: command.actorId,
    ...(command.to === 'published' ? { publishedAt: command.occurredAt } : {}),
  }

  return {
    cycle: nextCycle,
    auditEvent: {
      id: command.auditEventId,
      organizationId: cycle.organizationId,
      actorId: command.actorId,
      occurredAt: command.occurredAt,
      action: `cycle.transition.${cycle.status}.${command.to}`,
      entityType: 'AssignmentCycle',
      entityId: cycle.id,
      reason: command.reason,
      beforeVersion: cycle.version,
      afterVersion: nextCycle.version,
    },
  }
}
