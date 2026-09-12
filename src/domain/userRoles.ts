import type { RoleId } from './access'

export function effectiveProductRoles(coreRole: string, assigned: RoleId[], active = true): RoleId[] {
  if (!active) return []
  if (coreRole === 'student') return ['student']
  if (!['teacher', 'staff', 'school_admin'].includes(coreRole)) return []
  return [...new Set(assigned.filter((role) => role !== 'student' && (coreRole !== 'staff' || role !== 'course_instructor')))]
}

export function canAssignStaffRoles(coreRole: string): boolean {
  return coreRole === 'teacher' || coreRole === 'staff' || coreRole === 'school_admin'
}

export function withCourseInstructorRole(roles: RoleId[], hasAssignedCourse: boolean): RoleId[] {
  return hasAssignedCourse && !roles.includes('student') ? [...new Set([...roles, 'course_instructor' as const])] : roles
}
