import { expect, it } from 'vitest'
import { canAssignStaffRoles, effectiveProductRoles } from './userRoles'

it('never grants staff capabilities to a student even with historical assignments', () => {
  expect(effectiveProductRoles('student', ['access_manager', 'placement_coordinator'])).toEqual(['student'])
  expect(canAssignStaffRoles('student')).toBe(false)
  expect(effectiveProductRoles('student', [], false)).toEqual([])
})
it('keeps staff roles separate and fails closed for unknown membership types', () => {
  expect(effectiveProductRoles('teacher', ['student', 'course_instructor'])).toEqual(['course_instructor'])
  expect(effectiveProductRoles('unknown', ['access_manager'])).toEqual([])
  expect(canAssignStaffRoles('school_admin')).toBe(true)
  expect(effectiveProductRoles('staff', ['secretary'])).toEqual(['secretary'])
  expect(effectiveProductRoles('staff', ['secretary', 'course_instructor'])).toEqual(['secretary'])
  expect(canAssignStaffRoles('staff')).toBe(true)
})
