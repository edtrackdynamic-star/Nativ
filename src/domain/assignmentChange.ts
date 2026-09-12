export type ChangeAudience = 'student' | 'instructor' | 'secretary'

export interface AssignmentChangeRecord {
  id: string
  cycleId: string
  studentId: string
  studentName: string
  classLabel: string
  clusterId: string
  clusterLabel: string
  beforeCourseId: string
  beforeCourseLabel: string
  afterCourseId: string
  afterCourseLabel: string
  occurredAt: string
  source: 'appeal' | 'manual'
  secretaryAutoEventId: string
  dispatches?: Partial<Record<ChangeAudience, string>>
}
