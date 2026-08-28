import type { AssignmentCycle } from '../domain/cycle'
import type { PreferenceSubmission } from '../domain/preferences'
import type { AuditEvent } from '../domain/types'

export interface IdempotencyRecord {
  organizationId: string
  key: string
  fingerprint: string
  result: unknown
  completedAt: string
}

export interface NativTransaction {
  getCycle(organizationId: string, cycleId: string): AssignmentCycle | null
  listCycles(organizationId: string): AssignmentCycle[]
  saveCycle(cycle: AssignmentCycle, expectedVersion: number): void
  getSubmission(organizationId: string, submissionId: string): PreferenceSubmission | null
  listSubmissions(organizationId: string, cycleId: string): PreferenceSubmission[]
  saveSubmission(submission: PreferenceSubmission, expectedVersion: number): void
  appendAuditEvent(event: AuditEvent): void
  listAuditEvents(organizationId: string): AuditEvent[]
  getIdempotencyRecord(organizationId: string, key: string): IdempotencyRecord | null
  saveIdempotencyRecord(record: IdempotencyRecord): void
}

export interface NativRepository {
  transact<TResult>(operation: (transaction: NativTransaction) => TResult | Promise<TResult>): Promise<TResult>
}
