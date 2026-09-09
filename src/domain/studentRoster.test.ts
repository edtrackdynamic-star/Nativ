import { expect, it } from 'vitest'
import { filterStudents, type RosterFilters, type StudentRosterEntry } from './studentRoster'
const rows: StudentRosterEntry[] = [{ id: 's', name: 'תלמיד', classId: 'a', classLabel: 'ז1', status: 'assigned', choices: [{ clusterId: 'c', courseId: 'first', rank: 1 }], assignments: [{ clusterId: 'c', courseId: 'second' }] }]
const filters: RosterFilters = { query: '', classId: 'a', courseId: 'first', clusterId: '', status: '', mode: 'choices', rank: '1' }
it('distinguishes a ranked choice from actual assignment and combines class filters', () => {
  expect(filterStudents(rows, filters)).toHaveLength(1)
  expect(filterStudents(rows, { ...filters, mode: 'assignments' })).toHaveLength(0)
  expect(filterStudents(rows, { ...filters, classId: 'b' })).toHaveLength(0)
  expect(filterStudents(rows, { ...filters, rank: '2' })).toHaveLength(0)
})
