export type IsoTimestamp = string

export interface VersionedEntity {
  id: string
  organizationId: string
  version: number
  createdAt: IsoTimestamp
  createdBy: string
  updatedAt: IsoTimestamp
  updatedBy: string
}

export interface AuditEvent {
  id: string
  organizationId: string
  actorId: string
  occurredAt: IsoTimestamp
  action: string
  entityType: string
  entityId: string
  reason: string
  beforeVersion?: number
  afterVersion?: number
}

export interface ValidationIssue {
  code: string
  message: string
  path?: string
  severity: 'error' | 'warning'
}

export class DomainValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join('; '))
    this.name = 'DomainValidationError'
    this.issues = issues
  }
}

export class ConcurrentModificationError extends Error {
  constructor(expectedVersion: number, actualVersion: number) {
    super(`הגרסה השתנתה: ציפינו לגרסה ${expectedVersion}, אך הגרסה הנוכחית היא ${actualVersion}`)
    this.name = 'ConcurrentModificationError'
  }
}
