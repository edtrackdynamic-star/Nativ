export interface DirectoryStudent {
  studentId: string
  organizationId: string
  displayName: string
  classId: string
  classLabel: string
  email?: string
  active: boolean
}

export interface DirectoryProvider {
  getStudent(organizationId: string, studentId: string): Promise<DirectoryStudent | null>
  listStudents(organizationId: string): Promise<DirectoryStudent[]>
}

export class DirectoryUnavailableError extends Error {
  constructor() {
    super('הספרייה הארגונית אינה זמינה כעת')
    this.name = 'DirectoryUnavailableError'
  }
}
