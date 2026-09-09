export interface StudentRosterEntry {
  id: string; name: string; classId: string; classLabel: string
  status: 'not_submitted' | 'submitted' | 'assigned'
  choices: { clusterId: string; courseId: string; rank: number }[]
  assignments: { clusterId: string; courseId: string }[]
}
export interface RosterFilters { query: string; classId: string; courseId: string; clusterId: string; status: string; mode: 'choices' | 'assignments'; rank: string }
export function filterStudents(students: StudentRosterEntry[], filters: RosterFilters): StudentRosterEntry[] {
  return students.filter((student) => {
    if (filters.query && !student.name.includes(filters.query.trim())) return false
    if (filters.classId && (student.classId || 'unassigned') !== filters.classId) return false
    if (filters.status && student.status !== filters.status) return false
    const matches = filters.mode === 'choices' ? student.choices : student.assignments
    return (!filters.courseId && !filters.clusterId && !(filters.mode === 'choices' && filters.rank)) || matches.some((entry) =>
      (!filters.courseId || entry.courseId === filters.courseId) && (!filters.clusterId || entry.clusterId === filters.clusterId)
      && (filters.mode !== 'choices' || !filters.rank || ('rank' in entry && entry.rank === Number(filters.rank))))
  })
}
