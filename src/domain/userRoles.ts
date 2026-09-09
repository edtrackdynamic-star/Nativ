import type { RoleId } from './access'

export function effectiveProductRoles(coreRole: string, assigned: RoleId[], active = true): RoleId[] {
  if (!active) return []
  if (coreRole === 'student') return ['student']
  if (!['teacher', 'school_admin'].includes(coreRole)) return []
  return [...new Set(assigned.filter((role) => role !== 'student'))]
}

export function canAssignStaffRoles(coreRole: string): boolean {
  return coreRole === 'teacher' || coreRole === 'school_admin'
}
