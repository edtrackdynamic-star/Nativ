import type { IdempotencyRecord, NativRepository, NativTransaction } from '../../application/repository'
import type { AssignmentCycle } from '../../domain/cycle'
import type { PreferenceSubmission } from '../../domain/preferences'
import { ConcurrentModificationError } from '../../domain/types'
import type { AuditEvent } from '../../domain/types'

interface RepositoryState {
  cycles: Map<string, AssignmentCycle>
  submissions: Map<string, PreferenceSubmission>
  auditEvents: AuditEvent[]
  idempotencyRecords: Map<string, IdempotencyRecord>
}

export interface InMemorySeed {
  cycles?: AssignmentCycle[]
  submissions?: PreferenceSubmission[]
  auditEvents?: AuditEvent[]
}

function entityKey(organizationId: string, entityId: string): string {
  return `${organizationId}:${entityId}`
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function cloneState(state: RepositoryState): RepositoryState {
  return {
    cycles: new Map([...state.cycles].map(([key, value]) => [key, cloneValue(value)])),
    submissions: new Map([...state.submissions].map(([key, value]) => [key, cloneValue(value)])),
    auditEvents: cloneValue(state.auditEvents),
    idempotencyRecords: new Map([...state.idempotencyRecords].map(([key, value]) => [key, cloneValue(value)])),
  }
}

class InMemoryTransaction implements NativTransaction {
  private readonly state: RepositoryState

  constructor(state: RepositoryState) {
    this.state = state
  }

  getCycle(organizationId: string, cycleId: string): Promise<AssignmentCycle | null> {
    const cycle = this.state.cycles.get(entityKey(organizationId, cycleId))
    return Promise.resolve(cycle ? cloneValue(cycle) : null)
  }

  listCycles(organizationId: string): Promise<AssignmentCycle[]> {
    return Promise.resolve([...this.state.cycles.values()]
      .filter((cycle) => cycle.organizationId === organizationId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((cycle) => cloneValue(cycle)))
  }

  saveCycle(cycle: AssignmentCycle, expectedVersion: number): Promise<void> {
    const key = entityKey(cycle.organizationId, cycle.id)
    const currentVersion = this.state.cycles.get(key)?.version ?? 0
    if (currentVersion !== expectedVersion) {
      throw new ConcurrentModificationError(expectedVersion, currentVersion)
    }
    if (cycle.version !== expectedVersion + 1) {
      throw new ConcurrentModificationError(expectedVersion + 1, cycle.version)
    }
    this.state.cycles.set(key, cloneValue(cycle))
    return Promise.resolve()
  }

  getSubmission(organizationId: string, submissionId: string): Promise<PreferenceSubmission | null> {
    const submission = this.state.submissions.get(entityKey(organizationId, submissionId))
    return Promise.resolve(submission ? cloneValue(submission) : null)
  }

  listSubmissions(organizationId: string, cycleId: string): Promise<PreferenceSubmission[]> {
    return Promise.resolve([...this.state.submissions.values()]
      .filter((submission) => submission.organizationId === organizationId && submission.cycleId === cycleId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((submission) => cloneValue(submission)))
  }

  saveSubmission(submission: PreferenceSubmission, expectedVersion: number): Promise<void> {
    const key = entityKey(submission.organizationId, submission.id)
    const currentVersion = this.state.submissions.get(key)?.version ?? 0
    if (currentVersion !== expectedVersion) {
      throw new ConcurrentModificationError(expectedVersion, currentVersion)
    }
    if (submission.version !== expectedVersion + 1) {
      throw new ConcurrentModificationError(expectedVersion + 1, submission.version)
    }
    this.state.submissions.set(key, cloneValue(submission))
    return Promise.resolve()
  }

  appendAuditEvent(event: AuditEvent): Promise<void> {
    if (this.state.auditEvents.some((candidate) => candidate.id === event.id)) {
      throw new Error(`אירוע ביקורת כפול: ${event.id}`)
    }
    this.state.auditEvents.push(cloneValue(event))
    return Promise.resolve()
  }

  listAuditEvents(organizationId: string): Promise<AuditEvent[]> {
    return Promise.resolve(this.state.auditEvents
      .filter((event) => event.organizationId === organizationId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .map((event) => cloneValue(event)))
  }

  getIdempotencyRecord(organizationId: string, key: string): Promise<IdempotencyRecord | null> {
    const record = this.state.idempotencyRecords.get(entityKey(organizationId, key))
    return Promise.resolve(record ? cloneValue(record) : null)
  }

  saveIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    this.state.idempotencyRecords.set(entityKey(record.organizationId, record.key), cloneValue(record))
    return Promise.resolve()
  }
}

export class InMemoryNativRepository implements NativRepository {
  private state: RepositoryState
  private queue: Promise<void> = Promise.resolve()

  constructor(seed: InMemorySeed = {}) {
    this.state = {
      cycles: new Map((seed.cycles ?? []).map((cycle) => [entityKey(cycle.organizationId, cycle.id), cloneValue(cycle)])),
      submissions: new Map((seed.submissions ?? []).map((submission) => [entityKey(submission.organizationId, submission.id), cloneValue(submission)])),
      auditEvents: cloneValue(seed.auditEvents ?? []),
      idempotencyRecords: new Map(),
    }
  }

  transact<TResult>(operation: (transaction: NativTransaction) => TResult | Promise<TResult>): Promise<TResult> {
    const run = this.queue.then(async () => {
      const pendingState = cloneState(this.state)
      const result = await operation(new InMemoryTransaction(pendingState))
      this.state = pendingState
      return cloneValue(result)
    })
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }
}
