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
export interface AccessUserSummary { uid: string; email?: string; displayName?: string; coreRole?: string; roles: RoleId[]; capabilities: CapabilityId[]; active: boolean }
export interface NativSessionAccess { organizationId: string; organizationName: string; organizationLogoPath: string; roles: RoleId[]; capabilities: CapabilityId[]; accessMode: 'full' | 'read_only'; coreRole: string; displayName: string; email: string }
export interface GoogleAccessOption { id: string; name: string; role: string }

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

export async function listGoogleAccessOptions(): Promise<GoogleAccessOption[]> {
  return (await httpsCallable<Record<string, never>, { organizations: GoogleAccessOption[] }>(functionsClient(), 'getGoogleAccessOptions')({})).data.organizations
}

export async function exchangeGoogleIdentity(organizationId: string): Promise<string> {
  return (await httpsCallable<{ organizationId: string }, { customToken: string }>(functionsClient(), 'exchangeGoogleIdentity')({ organizationId })).data.customToken
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

export async function listCycles(): Promise<AssignmentCycle[]> {
  return (await httpsCallable<undefined, AssignmentCycle[]>(functionsClient(), 'listCycles')()).data
}

export async function createCycle(schoolYear: string, termLabel: string): Promise<AssignmentCycle> {
  return (await httpsCallable<Record<string, unknown>, AssignmentCycle>(functionsClient(), 'createCycle')({ schoolYear, termLabel })).data
}

export interface CatalogCourseDraft { documentUrl?: string; imageUrl?: string; label: string; description: string; subjectArea: string; instructorIds: string[]; minimum: number; target: number; maximum: number; repeatPolicy: 'allowed' | 'approval_required' | 'discouraged' | 'prohibited' }
export interface CatalogClusterDraft { eligibleClassIds?: string[]; description?: string; rationaleMode?: 'optional' | 'required' | 'hidden'; label: string; requiredRankingCount: number; balanceByClass: boolean; courses: CatalogCourseDraft[] }
export async function saveCycleCatalog(cycleId: string, clusters: CatalogClusterDraft[], formDesign?: import('../domain/formDesign').FormDesign, expectedVersion?: number): Promise<void> {
  await httpsCallable<Record<string, unknown>, unknown>(functionsClient(), 'saveCycleCatalog')({ cycleId, clusters, ...(formDesign ? { formDesign } : {}), ...(expectedVersion === undefined ? {} : {expectedVersion}) })
}
export async function listEligibleInstructors(): Promise<Array<{ uid: string; displayName: string }>> {
  return (await httpsCallable<undefined, Array<{ uid: string; displayName: string }>>(functionsClient(), 'listEligibleInstructors')()).data
}
export async function listEligibleClasses(): Promise<Array<{ id: string; name: string }>> {
  return (await httpsCallable<undefined, Array<{ id: string; name: string }>>(functionsClient(), 'listEligibleClasses')()).data
}
export interface CycleCatalogData { catalog: import('../domain/catalog').CycleCatalogSnapshot | null; courses: import('../domain/catalog').Course[] }
export async function getCycleCatalog(cycleId: string): Promise<CycleCatalogData> {
  return (await httpsCallable<{cycleId: string}, CycleCatalogData>(functionsClient(), 'getCycleCatalog')({cycleId})).data
}

export interface InstructorWorkspaceData { cycle: { schoolYear: string; termLabel: string; status: CycleStatus }; courses: Array<{ id: string; label: string; description: string; subjectArea: string; students: string[] }> }
export async function getInstructorWorkspace(cycleId: string): Promise<InstructorWorkspaceData> {
  return (await httpsCallable<{ cycleId: string }, InstructorWorkspaceData>(functionsClient(), 'getInstructorWorkspace')({ cycleId })).data
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

export async function getWorkflow(cycleId: string, view?: 'student' | 'coordinator' | 'appeal_reviewer' | 'secretary'): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'getWorkflow')({ cycleId, ...(view ? { view } : {}) })).data
}

export async function generateAiEvaluations(cycleId: string): Promise<WorkflowState> {
  return (await httpsCallable<{ cycleId: string }, WorkflowState>(functionsClient(), 'generateAiEvaluations', { timeout: 540000 })({ cycleId })).data
}

export async function getStudentRoster(cycleId: string): Promise<import('../domain/studentRoster').StudentRosterEntry[]> {
  return (await httpsCallable<{ cycleId: string }, import('../domain/studentRoster').StudentRosterEntry[]>(functionsClient(), 'getStudentRoster')({ cycleId })).data
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

export async function recommendAppeal(cycleId: string, appealId: string, outcome: 'approve' | 'reject' | 'more_information', reason: string): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'recommendAppeal')({ cycleId, appealId, outcome, reason })).data
}

export async function decideAppeal(cycleId: string, appealId: string, outcome: 'approved' | 'rejected'): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'decideAppeal')({ cycleId, appealId, outcome, reason: outcome === 'approved' ? 'הבקשה נמצאה אפשרית ומוצדקת' : 'הבקשה נדחתה לאחר בחינת הנתונים' })).data
}

export async function approveCapacityOverride(cycleId: string, appealId: string): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'approveCapacityOverride')({ cycleId, appealId, reason: 'אישור חריגת הקיבולת לאחר בחינת ההשפעה' })).data
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

export async function requestAccessCodeLogin(alias: string, code: string): Promise<string> {
  return (await httpsCallable<{organizationId: string; alias: string; code: string}, {customToken: string}>(functionsClient(), 'loginWithAccessCode')({organizationId: import.meta.env.VITE_ORGANIZATION_ID || 'democratic-wizo', alias, code})).data.customToken
}

export type DeliveryAudience = 'student' | 'staff'
export interface DeliveryPreview { signature:string; recipientSignature:string; version:number; messages:Array<{name:string;email:string;subject:string;text:string}>; skipped:number; alreadyQueued:boolean; status:{sent:number;failed:number;unknown:number;queued:number;failedBatches:number}|null }
export async function previewResultDelivery(cycleId:string,audience:DeliveryAudience):Promise<DeliveryPreview>{return (await httpsCallable<Record<string,unknown>,DeliveryPreview>(functionsClient(),'previewResultDelivery')({cycleId,audience})).data}
export async function sendResultDelivery(cycleId:string,audience:DeliveryAudience,preview:DeliveryPreview){await httpsCallable(functionsClient(),'sendResultDelivery')({cycleId,audience,signature:preview.signature,recipientSignature:preview.recipientSignature,expectedVersion:preview.version})}
export async function rejectAssignmentRun(cycleId:string,expectedVersion:number,reason:string){await httpsCallable(functionsClient(),'rejectAssignmentRun')({cycleId,expectedVersion,reason})}
