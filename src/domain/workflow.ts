import type { AiPriority, AssignmentResult } from './assignmentEngine'
import type { ClusterPreference } from './preferences'
import type { VersionedEntity } from './types'

export interface AiEvaluation {
  id: string
  anonymousStudentRef: string
  studentId: string
  clusterId: string
  sourceSubmissionId: string
  sourceSubmissionVersion: number
  input: { rankings: { courseId: string; rank: number }[]; rationale?: string }
  raw: { priority: AiPriority; summary: string; model: string; evaluatedAt: string }
  approved?: { priority: AiPriority; summary: string; approvedAt: string; approvedBy: string; reason: string }
}

export interface AssignmentRun {
  id: string
  executedAt: string
  executedBy: string
  algorithmVersion: 'legacy-compatible-1.0.0'
  seed: 42
  assignments: AssignmentResult[]
  enrollmentByCourse: Record<string, number>
  warnings: string[]
  tieBreaks: string[]
  approvedAt?: string
  approvedBy?: string
  publishedAt?: string
}

export interface AppealImpactAnalysis {
  analyzedAt: string
  baseWorkflowVersion: number
  beforeCourseId: string
  afterCourseId: string
  capacityBefore: { current: number; maximum: number }
  capacityAfter: { current: number; maximum: number }
  createsDuplicateCourse: boolean
  constraintViolations: string[]
  requiresMovingAnotherStudent: boolean
  affectedOutputs: string[]
}

export interface AppealRecord {
  id: string
  studentId: string
  clusterId: string
  requestedCourseId: string
  reason: string
  createdAt: string
  status: 'submitted' | 'approved_pending_execution' | 'rejected' | 'executed'
  originalPreference?: ClusterPreference
  originalSubmission?: { preferences: ClusterPreference[]; catalogSnapshot?: Array<{ clusterId: string; label: string; courses: Array<{ courseId: string; label: string }> }>; submittedAt?: string; submissionVersion?: number }
  sourceSubmissionId?: string
  sourceSubmissionVersion?: number
  aiEvaluationId?: string
  analysis?: AppealImpactAnalysis
  recommendation?: { outcome: 'approve' | 'reject' | 'more_information'; reason: string; recommendedAt: string; recommendedBy: string }
  capacityOverride?: { approvedAt: string; approvedBy: string; reason: string; baseWorkflowVersion: number }
  decision?: { outcome: 'approved' | 'rejected'; reason: string; decidedAt: string; decidedBy: string }
  executedAt?: string
  executedBy?: string
}

export interface NotificationRecord {
  id: string
  audience: 'secretary' | 'student' | 'coordinator'
  recipientRef: string
  channel: 'in_app' | 'email'
  subject: string
  body: string
  status: 'queued_mock' | 'available' | 'queued' | 'sent' | 'failed' | 'delivery_unknown'
  deliveryEventId?: string
  createdAt: string
}

export interface WorkflowHistoryEvent {
  id: string
  action: string
  actorId: string
  occurredAt: string
  reason: string
  workflowVersion: number
}

export interface WorkflowState extends VersionedEntity {
  cycleId: string
  aiBatchCreatedAt?: string
  aiEvaluations: AiEvaluation[]
  assignmentRun?: AssignmentRun
  appeals: AppealRecord[]
  notifications: NotificationRecord[]
  history: WorkflowHistoryEvent[]
}
