import type { ActorContext } from '../domain/access'
import type { CycleCatalogSnapshot } from '../domain/catalog'
import { transitionCycle as applyCycleTransition, type AssignmentCycle, type CycleStatus } from '../domain/cycle'
import { validatePreferenceSubmission, type PreferenceSubmission } from '../domain/preferences'
import { DomainValidationError, type AuditEvent } from '../domain/types'
import { assertCapability, assertOrganizationScope, assertStudentSelfOrManager } from './authorization'
import { AuthorizationError, EntityNotFoundError, IdempotencyConflictError } from './errors'
import type { NativRepository, NativTransaction } from './repository'

export interface TransitionCycleInput {
  organizationId: string
  cycleId: string
  expectedVersion: number
  to: CycleStatus
  reason: string
  occurredAt: string
  idempotencyKey: string
  auditEventId: string
}

export interface SaveDraftInput {
  organizationId: string
  cycleId: string
  studentId: string
  draft: PreferenceSubmission
  expectedVersion: number
  occurredAt: string
  idempotencyKey: string
  auditEventId: string
}

export interface SubmitPreferencesInput {
  organizationId: string
  cycleId: string
  studentId: string
  draftId: string
  expectedDraftVersion: number
  submittedSubmissionId: string
  submissionVersion: number
  occurredAt: string
  idempotencyKey: string
  auditEventId: string
}

export interface ChoiceContext {
  cycle: AssignmentCycle
  catalog: CycleCatalogSnapshot
}

function fingerprint(action: string, input: unknown): string {
  return JSON.stringify({ action, input })
}

async function requireCycle(transaction: NativTransaction, organizationId: string, cycleId: string): Promise<AssignmentCycle> {
  const cycle = await transaction.getCycle(organizationId, cycleId)
  if (!cycle) throw new EntityNotFoundError('מחזור', cycleId)
  return cycle
}

export class NativCommandService {
  private readonly repository: NativRepository

  constructor(repository: NativRepository) {
    this.repository = repository
  }

  async getCycle(actor: ActorContext, cycleId: string): Promise<AssignmentCycle> {
    assertCapability(actor, 'nativ.assignment.view')
    return this.repository.transact((transaction) => requireCycle(transaction, actor.organizationId, cycleId))
  }

  async getChoiceContext(actor: ActorContext, cycleId: string): Promise<ChoiceContext> {
    if (!actor.roles.includes('student') && !actor.capabilities.includes('nativ.assignment.view')) throw new AuthorizationError()
    return this.repository.transact(async (transaction) => {
      const cycle = await requireCycle(transaction, actor.organizationId, cycleId)
      const catalog = await transaction.getCatalogSnapshot(actor.organizationId, cycleId)
      if (!catalog) throw new EntityNotFoundError('צילום קטלוג', cycleId)
      return { cycle, catalog }
    })
  }

  async listMySubmissions(actor: ActorContext, cycleId: string): Promise<PreferenceSubmission[]> {
    if (!actor.roles.includes('student')) throw new AuthorizationError()
    return this.repository.transact(async (transaction) => {
      await requireCycle(transaction, actor.organizationId, cycleId)
      const submissions = await transaction.listSubmissions(actor.organizationId, cycleId)
      return submissions.filter((submission) => submission.studentId === actor.uid)
    })
  }

  async listAuditEvents(actor: ActorContext): Promise<AuditEvent[]> {
    assertCapability(actor, 'nativ.audit.view')
    return this.repository.transact((transaction) => transaction.listAuditEvents(actor.organizationId))
  }

  async transitionCycle(actor: ActorContext, input: TransitionCycleInput): Promise<AssignmentCycle> {
    assertOrganizationScope(actor, input.organizationId)
    assertCapability(actor, 'nativ.assignment.manage')
    if (input.to === 'published') {
      throw new DomainValidationError([{ code: 'cycle.publish_requires_approved_run', message: 'פרסום מתבצע רק מתוך מסך אישור השיבוץ', path: 'status', severity: 'error' }])
    }
    return this.executeIdempotently(input.organizationId, input.idempotencyKey, fingerprint('transitionCycle', input), input.occurredAt, async (transaction) => {
      const current = await requireCycle(transaction, input.organizationId, input.cycleId)
      if (current.status === 'draft' && input.to === 'choice_open') {
        const catalog = await transaction.getCatalogSnapshot(input.organizationId, input.cycleId)
        if (!catalog?.clusters.length || catalog.clusters.some((cluster) => !cluster.courses.length || cluster.requiredRankingCount > cluster.courses.length)) throw new DomainValidationError([{ code: 'cycle.catalog_required', message: 'יש להשלים מקבצים וקורסים לפני פתיחת הבחירה', path: 'catalog', severity: 'error' }])
      }
      const result = applyCycleTransition(current, {
        expectedVersion: input.expectedVersion,
        to: input.to,
        actorId: actor.uid,
        occurredAt: input.occurredAt,
        reason: input.reason,
        auditEventId: input.auditEventId,
      })
      await transaction.saveCycle(result.cycle, input.expectedVersion)
      await transaction.appendAuditEvent(result.auditEvent)
      return result.cycle
    })
  }

  async saveDraft(actor: ActorContext, input: SaveDraftInput): Promise<PreferenceSubmission> {
    assertOrganizationScope(actor, input.organizationId)
    assertStudentSelfOrManager(actor, input.studentId)
    if (actor.uid === input.studentId && !actor.roles.includes('student')) throw new AuthorizationError()
    return this.executeIdempotently(input.organizationId, input.idempotencyKey, fingerprint('saveDraft', input), input.occurredAt, async (transaction) => {
      const cycle = await requireCycle(transaction, input.organizationId, input.cycleId)
      if (cycle.status !== 'choice_open') {
        throw new DomainValidationError([{ code: 'draft.choice_not_open', message: 'ניתן לשמור טיוטה רק כאשר הבחירה פתוחה', severity: 'error' }])
      }
      if (input.draft.organizationId !== input.organizationId || input.draft.cycleId !== input.cycleId || input.draft.studentId !== input.studentId) {
        throw new DomainValidationError([{ code: 'draft.scope_mismatch', message: 'הטיוטה אינה תואמת לארגון, למחזור או לתלמיד', severity: 'error' }])
      }
      const catalogSnapshot = await transaction.getCatalogSnapshot(input.organizationId, input.cycleId)
      if (!catalogSnapshot) throw new EntityNotFoundError('צילום קטלוג', input.cycleId)
      const existing = await transaction.getSubmission(input.organizationId, input.draft.id)
      const savedDraft: PreferenceSubmission = {
        ...input.draft,
        status: 'draft',
        submittedAt: undefined,
        catalogSnapshot: structuredClone(catalogSnapshot.clusters),
        version: input.expectedVersion + 1,
        createdAt: existing?.createdAt ?? input.occurredAt,
        createdBy: existing?.createdBy ?? actor.uid,
        updatedAt: input.occurredAt,
        updatedBy: actor.uid,
      }
      await transaction.saveSubmission(savedDraft, input.expectedVersion)
      await transaction.appendAuditEvent({
        id: input.auditEventId,
        organizationId: input.organizationId,
        actorId: actor.uid,
        occurredAt: input.occurredAt,
        action: 'preference.draft.saved',
        entityType: 'PreferenceSubmission',
        entityId: savedDraft.id,
        reason: 'שמירת טיוטה',
        beforeVersion: input.expectedVersion || undefined,
        afterVersion: savedDraft.version,
      })
      return savedDraft
    })
  }

  async submitPreferences(actor: ActorContext, input: SubmitPreferencesInput): Promise<PreferenceSubmission> {
    assertOrganizationScope(actor, input.organizationId)
    assertStudentSelfOrManager(actor, input.studentId)
    if (actor.uid === input.studentId && !actor.roles.includes('student')) throw new AuthorizationError()
    return this.executeIdempotently(input.organizationId, input.idempotencyKey, fingerprint('submitPreferences', input), input.occurredAt, async (transaction) => {
      const cycle = await requireCycle(transaction, input.organizationId, input.cycleId)
      const draft = await transaction.getSubmission(input.organizationId, input.draftId)
      if (!draft) throw new EntityNotFoundError('טיוטה', input.draftId)
      if (draft.version !== input.expectedDraftVersion) {
        throw new DomainValidationError([{ code: 'submission.draft_version_changed', message: 'הטיוטה השתנתה ויש לרענן לפני ההגשה', severity: 'error' }])
      }
      if (draft.studentId !== input.studentId || draft.cycleId !== input.cycleId) {
        throw new DomainValidationError([{ code: 'submission.scope_mismatch', message: 'הטיוטה אינה שייכת לתלמיד או למחזור', severity: 'error' }])
      }

      const submitted: PreferenceSubmission = {
        ...draft,
        id: input.submittedSubmissionId,
        version: 1,
        submissionVersion: input.submissionVersion,
        status: 'submitted',
        submittedAt: input.occurredAt,
        createdAt: input.occurredAt,
        createdBy: actor.uid,
        updatedAt: input.occurredAt,
        updatedBy: actor.uid,
      }
      const issues = validatePreferenceSubmission(submitted, cycle)
      if (issues.length) throw new DomainValidationError(issues)
      await transaction.saveSubmission(submitted, 0)
      await transaction.appendAuditEvent({
        id: input.auditEventId,
        organizationId: input.organizationId,
        actorId: actor.uid,
        occurredAt: input.occurredAt,
        action: 'preference.submitted',
        entityType: 'PreferenceSubmission',
        entityId: submitted.id,
        reason: `הגשת גרסה ${submitted.submissionVersion}`,
        afterVersion: submitted.version,
      })
      return submitted
    })
  }

  private executeIdempotently<TResult>(
    organizationId: string,
    idempotencyKey: string,
    requestFingerprint: string,
    completedAt: string,
    operation: (transaction: NativTransaction) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    if (!idempotencyKey.trim()) {
      throw new DomainValidationError([{ code: 'command.idempotency_key_required', message: 'נדרש מזהה פעולה אידמפוטנטי', severity: 'error' }])
    }
    return this.repository.transact(async (transaction) => {
      const existing = await transaction.getIdempotencyRecord(organizationId, idempotencyKey)
      if (existing) {
        if (existing.fingerprint !== requestFingerprint) throw new IdempotencyConflictError()
        return existing.result as TResult
      }
      const result = await operation(transaction)
      await transaction.saveIdempotencyRecord({ organizationId, key: idempotencyKey, fingerprint: requestFingerprint, result, completedAt })
      return result
    })
  }
}
