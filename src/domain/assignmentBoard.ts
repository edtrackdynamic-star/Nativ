import type { AssignmentResult } from './assignmentEngine'
import type { Course, CycleCatalogSnapshot } from './catalog'
import { includesClass } from './classEligibility'
import type { StudentRosterEntry } from './studentRoster'
import { weeklySlotLabel } from './weeklySlot'
import type { AssignmentRun } from './workflow'

export type BoardCellStatus = 'assigned' | 'no_form' | 'unassigned' | 'excluded' | 'not_applicable'
export interface BoardCell { status: BoardCellStatus; assignment?: AssignmentResult; course?: Course }
export interface BoardStudent { id: string; name: string; classId: string; classLabel: string; hasForm: boolean; cells: Record<string, BoardCell> }
export interface BoardCourse { id: string; label: string; clusterId: string; clusterLabel: string; meetingPlace?: string; instructorNames: string[]; weeklySlot: string; target: number; maximum: number; students: BoardStudent[] }
export interface AssignmentBoard { clusters: { id: string; label: string; weeklySlot: string }[]; students: BoardStudent[]; courses: BoardCourse[]; issues: string[]; assignmentCount: number }

const collator = new Intl.Collator('he', { numeric: true })
const pairKey = (studentId: string, clusterId: string) => `${studentId}\u0000${clusterId}`

export function buildAssignmentBoard(run: AssignmentRun, roster: StudentRosterEntry[], courses: Course[], catalog: CycleCatalogSnapshot | null): AssignmentBoard {
  const clusters = (catalog?.clusters ?? []).map(cluster => ({ id: cluster.clusterId, label: cluster.label, weeklySlot: weeklySlotLabel(cluster.weeklySlot) }))
  const clusterById = new Map(catalog?.clusters.map(cluster => [cluster.clusterId, cluster]) ?? [])
  const courseById = new Map(courses.map(course => [course.id, course]))
  const rosterById = new Map(roster.map(student => [student.id, student]))
  const assignmentsByPair = new Map<string, AssignmentResult>()
  const issues: string[] = []

  for (const assignment of run.assignments) {
    const key = pairKey(assignment.studentId, assignment.clusterId)
    const originalChoices = rosterById.get(assignment.studentId)?.choices.filter(choice => choice.clusterId === assignment.clusterId) ?? []
    const displayedAssignment = originalChoices.length ? { ...assignment, rank: originalChoices.find(choice => choice.courseId === assignment.courseId)?.rank ?? null } : assignment
    if (assignmentsByPair.has(key)) issues.push(`נמצא יותר משיבוץ אחד לתלמיד/ה במקבץ ${clusterById.get(assignment.clusterId)?.label ?? assignment.clusterId}.`)
    else assignmentsByPair.set(key, displayedAssignment)
    if (!rosterById.has(assignment.studentId)) issues.push(`תלמיד/ה משובץ/ת אינו/ה מופיע/ה ברשימת התלמידים: ${assignment.studentLabel ?? assignment.studentId}.`)
    if (!courseById.has(assignment.courseId)) issues.push(`קורס משובץ אינו מופיע בקטלוג: ${assignment.courseId}.`)
    else if (courseById.get(assignment.courseId)?.clusterId !== assignment.clusterId) issues.push(`קורס משובץ אינו שייך למקבץ השיבוץ: ${assignment.courseId}.`)
    if (!clusterById.has(assignment.clusterId)) issues.push(`מקבץ משובץ אינו מופיע בקטלוג: ${assignment.clusterId}.`)
  }

  const allStudents = [...roster]
  for (const assignment of run.assignments) if (!rosterById.has(assignment.studentId) && !allStudents.some(student => student.id === assignment.studentId)) {
    allStudents.push({ id: assignment.studentId, name: assignment.studentLabel ?? 'תלמיד/ה ללא שם', classId: '', classLabel: assignment.studentClassLabel ?? 'ללא כיתת־אם', status: 'not_submitted', choices: [], assignments: [] })
  }
  const students = allStudents.map(student => {
    const hasForm = Boolean(student.choiceSource || student.choices.length)
    const cells: Record<string, BoardCell> = {}
    for (const cluster of catalog?.clusters ?? []) {
      const assignment = assignmentsByPair.get(pairKey(student.id, cluster.clusterId))
      const excluded = run.scope?.excludedClassIdsByCluster[cluster.clusterId]?.includes(student.classId) || run.scope?.excludedStudentIdsByCluster[cluster.clusterId]?.includes(student.id)
      const applicable = includesClass(cluster, student.classId)
      cells[cluster.clusterId] = assignment
        ? { status: 'assigned', assignment, course: courseById.get(assignment.courseId) }
        : { status: !applicable ? 'not_applicable' : excluded ? 'excluded' : hasForm ? 'unassigned' : 'no_form' }
      if (assignment && !applicable) issues.push(`שיבוץ במקבץ שאינו מיועד לכיתה: ${student.name}, ${cluster.label}.`)
    }
    return { id: student.id, name: student.name, classId: student.classId, classLabel: student.classLabel, hasForm, cells }
  }).sort((a, b) => collator.compare(a.classLabel, b.classLabel) || collator.compare(a.name, b.name))

  const boardStudentById = new Map(students.map(student => [student.id, student]))
  const boardCourses = courses.map(course => {
    const cluster = clusterById.get(course.clusterId)
    const snapshot = cluster?.courses.find(entry => entry.courseId === course.id)
    return { id: course.id, label: course.label, clusterId: course.clusterId, clusterLabel: cluster?.label ?? 'מקבץ חסר', meetingPlace: course.meetingPlace,
      instructorNames: snapshot?.instructorNames ?? [], weeklySlot: weeklySlotLabel(cluster?.weeklySlot), target: course.capacity.target, maximum: course.capacity.maximum,
      students: run.assignments.filter(assignment => assignment.courseId === course.id).map(assignment => boardStudentById.get(assignment.studentId)).filter((student): student is BoardStudent => Boolean(student)).sort((a, b) => collator.compare(a.classLabel, b.classLabel) || collator.compare(a.name, b.name)) }
  })
  const clusterOrder = new Map(clusters.map((cluster, index) => [cluster.id, index]))
  const courseOrder = new Map(catalog?.clusters.flatMap(cluster => cluster.courses.map((course, index) => [course.courseId, index] as const)) ?? [])
  boardCourses.sort((a, b) => (clusterOrder.get(a.clusterId) ?? Number.MAX_SAFE_INTEGER) - (clusterOrder.get(b.clusterId) ?? Number.MAX_SAFE_INTEGER) || (courseOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (courseOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || collator.compare(a.label, b.label))
  for (const course of boardCourses) {
    if (course.students.length > course.maximum) issues.push(`בקורס ${course.label} יש ${course.students.length} תלמידים, מעל הקיבולת המרבית ${course.maximum}.`)
    if (run.enrollmentByCourse[course.id] !== undefined && run.enrollmentByCourse[course.id] !== course.students.length) issues.push(`ספירת המשובצים בקורס ${course.label} אינה תואמת את נתוני ההרצה.`)
  }
  if (run.includedStudentClusterCount !== undefined && run.assignments.length !== run.includedStudentClusterCount) issues.push(`מספר השיבוצים (${run.assignments.length}) שונה ממספר המקומות שנכללו בהרצה (${run.includedStudentClusterCount}).`)
  return { clusters, students, courses: boardCourses, issues: [...new Set(issues)], assignmentCount: run.assignments.length }
}

export function boardCellLabel(cell: BoardCell): string {
  if (cell.status === 'assigned') return cell.course?.label ?? 'קורס חסר בקטלוג'
  return ({ no_form: 'לא הוגש טופס', unassigned: 'לא שובץ', excluded: 'לא נכלל בהרצה', not_applicable: 'לא מיועד לכיתה' } as const)[cell.status]
}
