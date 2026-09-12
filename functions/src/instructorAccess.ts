import { nativFirestore } from './firebase'
import type { RoleId } from '../../src/domain/access'
import { withCourseInstructorRole } from '../../src/domain/userRoles'

const catalogCollection = (organizationId: string) => nativFirestore.collection(`organizations/${organizationId}/nativCourseCatalogs`)
export const instructorAccessPath = (organizationId: string, uid: string) => `organizations/${organizationId}/nativInstructorAccess/${uid}`

function assignedIds(data: FirebaseFirestore.DocumentData | undefined): string[] {
  if (!data || !Array.isArray(data.courses)) return []
  return [...new Set(data.courses.flatMap((course: { instructorIds?: unknown }) => Array.isArray(course.instructorIds) ? course.instructorIds.filter((id): id is string => typeof id === 'string') : []))]
}

export async function hasAssignedCourse(organizationId: string, uid: string): Promise<boolean> {
  const indexed = await nativFirestore.doc(instructorAccessPath(organizationId, uid)).get()
  if (indexed.exists) return Array.isArray(indexed.data()?.cycleIds) && indexed.data()!.cycleIds.length > 0
  const catalogs = await catalogCollection(organizationId).get()
  return catalogs.docs.some((catalog) => assignedIds(catalog.data()).includes(uid))
}

export async function rolesWithAssignedCourses(organizationId: string, rolesByUid: Map<string, RoleId[]>): Promise<Map<string, RoleId[]>> {
  const catalogs = await catalogCollection(organizationId).get()
  const assigned = new Set(catalogs.docs.flatMap((catalog) => assignedIds(catalog.data())))
  return new Map([...rolesByUid].map(([uid, roles]) => [uid, withCourseInstructorRole(roles, assigned.has(uid))]))
}

export async function syncInstructorAccess(transaction: FirebaseFirestore.Transaction, organizationId: string, cycleId: string, newInstructorIds: string[]): Promise<void> {
  const catalogs = await transaction.get(catalogCollection(organizationId))
  const current = catalogs.docs.find((catalog) => catalog.id === cycleId)
  const affected = new Set([...assignedIds(current?.data()), ...newInstructorIds])
  for (const uid of affected) {
    const cycleIds = catalogs.docs.filter((catalog) => catalog.id !== cycleId && assignedIds(catalog.data()).includes(uid)).map((catalog) => catalog.id)
    if (newInstructorIds.includes(uid)) cycleIds.push(cycleId)
    transaction.set(nativFirestore.doc(instructorAccessPath(organizationId, uid)), { organizationId, uid, cycleIds: [...new Set(cycleIds)] })
  }
}
