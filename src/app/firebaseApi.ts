import { httpsCallable } from 'firebase/functions'
import type { ChoiceContext } from '../application/NativCommandService'
import type { AssignmentCycle, CycleStatus } from '../domain/cycle'
import type { ClusterPreference, PreferenceSubmission } from '../domain/preferences'
import type { AuditEvent } from '../domain/types'
import type { AiPriority } from '../domain/assignmentEngine'
import type { AppealRecord, AssignmentParticipationScope, AssignmentRun, WorkflowState } from '../domain/workflow'
import type { CapabilityId, RoleId } from '../domain/access'
import { nativFunctions } from '../infrastructure/firebase/client'

export interface DemoAccount { label: string; email: string; password: string }
export interface AccessUserSummary { uid: string; email?: string; displayName?: string; coreRole?: string; roles: RoleId[]; capabilities: CapabilityId[]; active: boolean }
export interface NativSessionAccess { organizationId: string; organizationName: string; organizationLogoPath: string; roles: RoleId[]; capabilities: CapabilityId[]; accessMode: 'full' | 'read_only'; coreRole: string; displayName: string; email: string }
export interface GoogleAccessOption { id: string; name: string; role: string }
export interface LoginSchool { id: string; name: string }

export async function listLoginSchools(): Promise<LoginSchool[]> {
  return (await httpsCallable<Record<string, never>, { schools: LoginSchool[] }>(functionsClient(), 'listLoginSchools')({})).data.schools
}

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

export interface CatalogCourseDraft { capacityLimit?: number; documentUrl?: string; imageUrl?: string; meetingPlace?: string; label: string; description: string; subjectArea: string; instructorIds: string[]; minimum: number; target: number; maximum: number; repeatPolicy: 'allowed' | 'approval_required' | 'discouraged' | 'prohibited' }
export interface CatalogClusterDraft { capacityFlexibility?: number; eligibleClassIds?: string[]; weeklySlot?: import('../domain/weeklySlot').WeeklySlot; description?: string; rationaleMode?: 'optional' | 'required' | 'hidden'; label: string; requiredRankingCount: number; balanceByClass: boolean; courses: CatalogCourseDraft[] }
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
export async function updateCourseMeetingPlace(cycleId: string, courseId: string, meetingPlace: string, expectedVersion: number): Promise<import('../domain/catalog').Course> {
  return (await httpsCallable<{cycleId:string;courseId:string;meetingPlace:string;expectedVersion:number}, import('../domain/catalog').Course>(functionsClient(), 'updateCourseMeetingPlace')({cycleId,courseId,meetingPlace,expectedVersion})).data
}

export async function setChoiceDeadline(cycleId: string, expectedVersion: number, choiceClosesAt: string | null): Promise<AssignmentCycle> {
  return (await httpsCallable<Record<string, unknown>, AssignmentCycle>(functionsClient(), 'setChoiceDeadline')({ cycleId, expectedVersion, choiceClosesAt })).data
}
export interface ExtractedDescriptionResult { sourceCourseName: string; sourceTeacherName: string; description: string; proposedCourseId: string; match: 'clear' | 'review' }
export type DescriptionSource = { kind: 'google_docs'; url: string } | { kind: 'stored_docx'; cycleId: string; path: string }
export async function uploadCycleDocument(cycleId: string, file: File): Promise<{path:string;fileName:string}> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return (await httpsCallable<Record<string, unknown>, {path:string;fileName:string}>(functionsClient(), 'uploadCycleDocument', { timeout: 120000 })({ cycleId, fileName: file.name, base64: btoa(binary) })).data
}
export async function downloadCycleDocument(cycleId: string, previewPath?: string): Promise<void> {
  const result = (await httpsCallable<Record<string, unknown>, {base64:string;fileName:string}>(functionsClient(), 'downloadCycleDocument', { timeout: 120000 })({ cycleId, ...(previewPath ? { previewPath } : {}) })).data
  const binary = atob(result.base64)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}))
  const link = document.createElement('a')
  link.href = url
  link.download = result.fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
export async function extractCourseDescriptions(source: DescriptionSource, candidates: Array<{id:string;label:string;instructorNames:string[]}>): Promise<{results:ExtractedDescriptionResult[];readerEmail:string}> {
  return (await httpsCallable<Record<string, unknown>, {results:ExtractedDescriptionResult[];readerEmail:string}>(functionsClient(), 'extractCourseDescriptions', {timeout:180000})({...source,candidates})).data
}

export interface InstructorWorkspaceData { cycle: { schoolYear: string; termLabel: string; status: CycleStatus }; documentUrl?: string; hasWordDocument?: boolean; courses: Array<{ id: string; label: string; description: string; subjectArea: string; weeklySlot?: import('../domain/weeklySlot').WeeklySlot; students: string[] }> }
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

export async function generateAiEvaluations(cycleId: string, refresh = false): Promise<WorkflowState> {
  return (await httpsCallable<{ cycleId: string; refresh: boolean }, WorkflowState>(functionsClient(), 'generateAiEvaluations', { timeout: 540000 })({ cycleId, refresh })).data
}

export async function setClusterWeeklySlots(cycleId:string,expectedVersion:number,slots:Array<{clusterId:string;weeklySlot?:import('../domain/weeklySlot').WeeklySlot}>):Promise<import('../domain/catalog').CycleCatalogSnapshot> {
  return (await httpsCallable<Record<string,unknown>,import('../domain/catalog').CycleCatalogSnapshot>(functionsClient(),'setClusterWeeklySlots')({cycleId,expectedVersion,slots})).data
}

export async function setAppealDeadline(cycleId:string,expectedVersion:number,appealClosesAt:string|null):Promise<AssignmentCycle> {
  return (await httpsCallable<Record<string,unknown>,AssignmentCycle>(functionsClient(),'setAppealDeadline')({cycleId,expectedVersion,appealClosesAt})).data
}

export async function getStudentRoster(cycleId: string): Promise<import('../domain/studentRoster').StudentRosterEntry[]> {
  return (await httpsCallable<{ cycleId: string }, import('../domain/studentRoster').StudentRosterEntry[]>(functionsClient(), 'getStudentRoster')({ cycleId })).data
}

export async function approveAiEvaluation(cycleId: string, evaluationId: string, priority: AiPriority, summary: string, coursePriorities?: { courseId: string; priority: AiPriority }[]): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'approveAiEvaluation')({ cycleId, evaluationId, priority, summary, ...(coursePriorities ? { coursePriorities } : {}), reason: 'בדיקה ואישור של רכז השיבוץ' })).data
}

export async function approveAiEvaluations(cycleId: string, mode: 'clear_only' | 'all', expectedVersion: number): Promise<WorkflowState> {
  return (await httpsCallable<{ cycleId: string; mode: 'clear_only' | 'all'; expectedVersion: number }, WorkflowState>(functionsClient(), 'approveAiEvaluations')({ cycleId, mode, expectedVersion })).data
}

export async function runAssignment(cycleId: string, label = 'הרצת שיבוץ', scope?: AssignmentParticipationScope): Promise<WorkflowState> {
  return (await httpsCallable<Record<string,unknown>, WorkflowState>(functionsClient(), 'runAssignment')({ cycleId, label, ...(scope?{scope}:{}) })).data
}

export async function listAssignmentRuns(cycleId:string):Promise<AssignmentRun[]> {
  return (await httpsCallable<{cycleId:string},AssignmentRun[]>(functionsClient(),'listAssignmentRuns')({cycleId})).data
}

export async function selectAssignmentRun(cycleId:string,runId:string):Promise<WorkflowState> {
  return (await httpsCallable<{cycleId:string;runId:string},WorkflowState>(functionsClient(),'selectAssignmentRun')({cycleId,runId})).data
}

export async function saveManualProposedAssignment(cycleId:string,studentId:string,clusterId:string,courseId:string,reason:string,expectedVersion:number):Promise<WorkflowState> {
  return (await httpsCallable<Record<string,unknown>,WorkflowState>(functionsClient(),'saveManualProposedAssignment')({cycleId,studentId,clusterId,courseId,reason,expectedVersion})).data
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

export async function decideAppeal(cycleId: string, appealId: string, outcome: 'approved' | 'rejected', reason: string): Promise<WorkflowState> {
  return (await httpsCallable<Record<string, unknown>, WorkflowState>(functionsClient(), 'decideAppeal')({ cycleId, appealId, outcome, reason })).data
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

export async function requestAccessCodeLogin(organizationId: string, alias: string, code: string): Promise<string> {
  return (await httpsCallable<{organizationId: string; alias: string; code: string}, {customToken: string}>(functionsClient(), 'loginWithAccessCode')({organizationId, alias, code})).data.customToken
}

export type DeliveryAudience = 'student' | 'staff'
export interface DeliveryPreview { signature:string; recipientSignature:string; version:number; messages:Array<{name:string;email:string;subject:string;text:string}>; skipped:number; alreadyQueued:boolean; status:{sent:number;failed:number;unknown:number;queued:number;failedBatches:number}|null }
export async function previewResultDelivery(cycleId:string,audience:DeliveryAudience):Promise<DeliveryPreview>{return (await httpsCallable<Record<string,unknown>,DeliveryPreview>(functionsClient(),'previewResultDelivery')({cycleId,audience})).data}
export async function sendResultDelivery(cycleId:string,audience:DeliveryAudience,preview:DeliveryPreview){await httpsCallable(functionsClient(),'sendResultDelivery')({cycleId,audience,signature:preview.signature,recipientSignature:preview.recipientSignature,expectedVersion:preview.version})}
export type ChangeAudience = import('../domain/assignmentChange').ChangeAudience
export interface ChangeDeliveryPreview { signature:string; recipientSignature:string; version:number; changes:import('../domain/assignmentChange').AssignmentChangeRecord[]; messages:Array<{name:string;email:string;subject:string;text:string}>; skipped:number; autoHandled:number; needsReview:number; delivery:{sent:number;queued:number;failed:number;unknown:number} }
export async function previewAssignmentChangeDelivery(cycleId:string,audience:ChangeAudience,changeId?:string):Promise<ChangeDeliveryPreview>{return (await httpsCallable<Record<string,unknown>,ChangeDeliveryPreview>(functionsClient(),'previewAssignmentChangeDelivery')({cycleId,audience,changeId})).data}
export async function sendAssignmentChangeDelivery(cycleId:string,audience:ChangeAudience,preview:ChangeDeliveryPreview,changeId?:string){return (await httpsCallable<Record<string,unknown>,{alreadyQueued:boolean}>(functionsClient(),'sendAssignmentChangeDelivery')({cycleId,audience,changeId,signature:preview.signature,recipientSignature:preview.recipientSignature,expectedVersion:preview.version})).data}
export async function changeStudentAssignment(cycleId:string,studentId:string,clusterId:string,requestedCourseId:string,reason:string,expectedWorkflowVersion:number):Promise<{workflow:WorkflowState;changeId:string}>{return (await httpsCallable<Record<string,unknown>,{workflow:WorkflowState;changeId:string}>(functionsClient(),'changeStudentAssignment')({cycleId,studentId,clusterId,requestedCourseId,reason,expectedWorkflowVersion})).data}
export interface OperationalIncident { id:string; action:string; category:string; occurredAt:string; lastSeenAt:string; occurrences:number; status:string }
export async function listOperationalIncidents():Promise<OperationalIncident[]>{return (await httpsCallable<undefined,OperationalIncident[]>(functionsClient(),'listOperationalIncidents')()).data}
export async function rejectAssignmentRun(cycleId:string,expectedVersion:number,reason:string){await httpsCallable(functionsClient(),'rejectAssignmentRun')({cycleId,expectedVersion,reason})}
