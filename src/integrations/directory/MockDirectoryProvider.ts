import type { DirectoryProvider, DirectoryStudent } from './DirectoryProvider'

const mockStudents: DirectoryStudent[] = [{ studentId: 'student-demo-001', organizationId: 'org-demo', displayName: 'תלמידת הדגמה', classId: 'class-demo-7a', classLabel: 'ז׳1', email: 'demo@example.invalid', active: true }]

export class MockDirectoryProvider implements DirectoryProvider {
  async getStudent(organizationId: string, studentId: string) {
    return mockStudents.find((student) => student.organizationId === organizationId && student.studentId === studentId) ?? null
  }

  async listStudents(organizationId: string) {
    return mockStudents.filter((student) => student.organizationId === organizationId)
  }
}
