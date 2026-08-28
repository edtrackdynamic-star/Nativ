import { httpsCallable } from 'firebase/functions'
import type { ChoiceContext } from '../application/NativCommandService'
import type { AssignmentCycle, CycleStatus } from '../domain/cycle'
import type { ClusterPreference, PreferenceSubmission } from '../domain/preferences'
import type { AuditEvent } from '../domain/types'
import type { AiPriority } from '../domain/assignmentEngine'
import type { AppealRecord, WorkflowState } from '../domain/workflow'
import type { CapabilityId, RoleId } from '../domain/access'
import { nativFunctions } from '../infrastructure/firebase/client'

export interface DemoAccount { label: string; email: string; password: string }
export interface AccessUserSummary { uid: string; email?: string; displayName?: string; roles: RoleId[]; capabilities: CapabilityId[]; active: boolean }
export interface NativSessionAccess { organizationId: string; roles: RoleId[]; capabilities: CapabilityId[]; accessMode: 'full' | 'read_only'; coreRole: string; displayName: string; email: string }

function functionsClient() {
  if (!nativFunctions) throw new Error('Firebase אינו מוגדר בסביבה זו')
  return nativFunctions
}

export async function seedDemoEnvironment(): Promise<{ cycleId: string; accounts: DemoAccount[] }> {
  return (await httpsCallable<undefined, { cycleId: string; accounts: DemoAccount[] }>(functionsClient(), 'seedDemoEnvironment')()).data
}

export async function getMyNativAccess(): Promise<NativSessionAccess> {
  return (await httpsCallable<undefined, NativSessionAccess>(functionsClient(), 'getMyNativAccess')()).data
}

export async function claimInitialAccessManager(): Promise<void> {
  await httpsCallable<undefined, { activated: boolean }>(functionsClient(), 'claimInitialAccessManager')()
}

export async function getChoiceContext(cycleId: string): Promise<ChoiceContext> {
  return (await httpsCallable<{ cycleId: string }, ChoiceContext>(functionsClient(), 'getChoiceContext')({ cycleId })).data
}

export async function getCycle(cycleId: string): Promise<AssignmentCycle> {
  return (await httpsCallable<{ cycleId: string }, AssignmentCycle>(functionsClient(), 'getCycle')({ cycleId })).data
}

export async function transitionCycle(cycle: AssignmentCycle, to: CycleStatus, reason: string): Promise<AssignmentCycle> {
  return (await httpsCallable<Record<string, unknown>, AssignmentCycle>(functionsClient(), 'transitionCycle')({ cycleId: cycle.id, expectedVersion: cycle.version, to, reason, idempotencyKey: crypto.randomUUID() })).data
}

export async function savePreferenceDraft(cycleId: string, preferences: ClusterPreference[], expectedVersion: number): Promise<PreferenceSubmission> {
  return (await httpsCallable<Record<string, unknown>, PreferenceSubmission>(functionsClient(), 'savePreferenceDraft')({ cycleId, preferences, expectedVersion, idempotencyKey: crypto.randomUUID() })).data
}

export async function submitPreferenceDraft(cycleId: string, expectedDraftVersion: number, submissionVersion: number): Promise<PreferenceSubmission> {
  return (await httpsCallable<Record<string, unknown>, PreferenceSubmission>(functionsClient(), 'submitPreferences')({ cycleId, expectedDraftVersion, submissionVersion, idempotencyKey: crypto.randomUUID() })).data
}

export async function listMySubmissions(cycleId: string): Promise<PreferenceSubmission[]> {
  return (await httpsCallable<{ cycleId: string }, PreferenceSubmission[]>(functionsClient(), 'listMySubmissions')({ cycleId })).data
}

export async function listAuditEvents(): Promise<AuditEvent[]> {
  return (await httpsCallable<undefined, AuditEvent[]>(functionsClient(), 'listAuditEvents')()).data
}

export async function getWorkflow(cycleId: string): Promise<WorkflowState> {
  return (await httpsCallable<{ cycleId: string }, WorkflowState>(functionsClient(), 'getWorkflow')({ cycleId })).data
}

export async function generateAiEvaluations(cycleId: string): Promise<WorkflowState> {
  return (await httpsCallable<{ cycleId: string }, WorkflowState>(functionsClient(), 'generateAiEvaluations')({ cycleId })).data
}

export async function approveAiEvaluation(cycleId: string, evaluationId: string, priority: AiPriority, summary: string): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'approveAiEvaluation')({ cycleId, evaluationId, priority, summary, reason: 'בדיקה ואישור של רכז השיבוץ' })).data
}

export async function runAssignment(cycleId: string): Promise<WorkflowState> {
  return (await httpsCallable<{ cycleId: string }, WorkflowState>(functionsClient(), 'runAssignment')({ cycleId })).data
}

export async function approveAssignmentRun(cycleId: string): Promise<WorkflowState> {
  return (await httpsCallable<{ cycleId: string }, WorkflowState>(functionsClient(), 'approveAssignmentRun')({ cycleId })).data
}

export async function publishAssignments(cycleId: string): Promise<WorkflowState> {
  return (await httpsCallable<{ cycleId: string }, WorkflowState>(functionsClient(), 'publishAssignments')({ cycleId })).data
}

export async function submitAppeal(cycleId: string, clusterId: string, requestedCourseId: string, reason: string): Promise<AppealRecord> {
  return (await httpsCallable<Record<string, unknown>, AppealRecord>(functionsClient(), 'submitAppeal')({ cycleId, clusterId, requestedCourseId, reason })).data
}

export async function analyzeAppeal(cycleId: string, appealId: string): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'analyzeAppeal')({ cycleId, appealId })).data
}

export async function decideAppeal(cycleId: string, appealId: string, outcome: 'approved' | 'rejected'): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'decideAppeal')({ cycleId, appealId, outcome, reason: outcome === 'approved' ? 'הבקשה נמצאה אפשרית ומוצדקת' : 'הבקשה נדחתה לאחר בחינת הנתונים' })).data
}

export async function executeAppealChange(cycleId: string, appealId: string, expectedWorkflowVersion: number): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'executeAppealChange')({ cycleId, appealId, expectedWorkflowVersion })).data
}

export async function listAccessUsers(): Promise<AccessUserSummary[]> {
  return (await httpsCallable<undefined, AccessUserSummary[]>(functionsClient(), 'listAccessUsers')()).data
}

export async function setUserAccess(uid: string, roles: RoleId[], active: boolean): Promise<void> {
  await httpsCallable<Record<string, unknown>, unknown>(functionsClient(), 'setUserAccess')({ uid, roles, active })
}
