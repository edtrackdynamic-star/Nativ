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
  getCycle(organizationId: string, cycleId: string): Promise<AssignmentCycle | null>
  listCycles(organizationId: string): Promise<AssignmentCycle[]>
  saveCycle(cycle: AssignmentCycle, expectedVersion: number): Promise<void>
  getSubmission(organizationId: string, submissionId: string): Promise<PreferenceSubmission | null>
  listSubmissions(organizationId: string, cycleId: string): Promise<PreferenceSubmission[]>
  saveSubmission(submission: PreferenceSubmission, expectedVersion: number): Promise<void>
  appendAuditEvent(event: AuditEvent): Promise<void>
  listAuditEvents(organizationId: string): Promise<AuditEvent[]>
  getIdempotencyRecord(organizationId: string, key: string): Promise<IdempotencyRecord | null>
  saveIdempotencyRecord(record: IdempotencyRecord): Promise<void>
}

export interface NativRepository {
  transact<TResult>(operation: (transaction: NativTransaction) => TResult | Promise<TResult>): Promise<TResult>
}
