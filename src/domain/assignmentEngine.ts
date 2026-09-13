import { includesClass } from './classEligibility'
import type { Course } from './catalog'
import type { ClusterPreference } from './preferences'

export type AiPriority = 'high' | 'medium' | 'neutral'

export interface AssignmentStudent {
  studentId: string
  displayLabel: string
  classId?: string
  classLabel?: string
  submission?: { preferences: ClusterPreference[] }
  approvedAiByCluster?: Record<string, AiPriority>
  approvedAiByCourse?: Record<string, AiPriority>
  previouslyCompletedLogicalCourseIds?: string[]
}

export interface HardConstraint {
  studentId: string
  clusterId: string
  type: 'must_assign' | 'must_not_assign'
  courseId: string
  note: string
}

export interface AssignmentResult {
  studentId: string
  studentLabel?: string
  studentClassLabel?: string
  clusterId: string
  courseId: string
  rank: number | null
  source: 'hard_constraint' | 'ranked_choice' | 'fallback_submitter' | 'fallback_non_submitter'
  aiPriority: AiPriority
  explanation: string
}

export interface AssignmentRunResult {
  assignments: AssignmentResult[]
  enrollmentByCourse: Record<string, number>
  warnings: string[]
  tieBreaks: string[]
}

const priorityValue: Record<AiPriority, number> = { high: 3, medium: 2, neutral: 1 }
const priorityForCourse = (student: AssignmentStudent, clusterId: string, courseId: string): AiPriority =>
  student.approvedAiByCourse?.[courseId] ?? student.approvedAiByCluster?.[clusterId] ?? 'neutral'

function deterministicKey(value: string): string {
  let hash = 2166136261
  for (const character of `42|${value}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function isRepeatAllowed(course: Course, student: AssignmentStudent): boolean {
  const repeated = student.previouslyCompletedLogicalCourseIds?.includes(course.logicalCourseId) ?? false
  return !repeated || course.repeatPolicy !== 'prohibited'
}

export function runDeterministicAssignment(input: {
  cycleId: string
  clusterIds: string[]
  courses: Course[]
  students: AssignmentStudent[]
  constraints?: HardConstraint[]
  balanceByClassClusterIds?: string[]
  eligibleClassIdsByCluster?: Record<string, string[] | undefined>
  excludedClassIdsByCluster?: Record<string, string[] | undefined>
  excludedStudentIdsByCluster?: Record<string, string[] | undefined>
}): AssignmentRunResult {
  const assignments: AssignmentResult[] = []
  const warnings: string[] = []
  const tieBreaks: string[] = []
  const enrollmentByCourse: Record<string, number> = Object.fromEntries(input.courses.map((course) => [course.id, 0]))

  for (const clusterId of input.clusterIds) {
    const excludedClasses = new Set(input.excludedClassIdsByCluster?.[clusterId] ?? [])
    const excludedStudents = new Set(input.excludedStudentIdsByCluster?.[clusterId] ?? [])
    const students = input.students.filter(student => includesClass({ eligibleClassIds: input.eligibleClassIdsByCluster?.[clusterId] }, student.classId)
      && !excludedStudents.has(student.studentId) && !(student.classId && excludedClasses.has(student.classId)))
    const courses = input.courses.filter((course) => course.clusterId === clusterId && course.published)
    const assigned = new Set<string>()
    const constraints = input.constraints?.filter((constraint) => constraint.clusterId === clusterId) ?? []
    const balanceByClass = input.balanceByClassClusterIds?.includes(clusterId) ?? false
    const classEnrollmentByCourse: Record<string, Record<string, number>> = Object.fromEntries(courses.map((course) => [course.id, {}]))
    const classCount = (student: AssignmentStudent, course: Course) => student.classId ? (classEnrollmentByCourse[course.id]?.[student.classId] ?? 0) : 0
    const classDifference = (left: AssignmentStudent, right: AssignmentStudent, course: Course) => left.classId && right.classId ? classCount(left, course) - classCount(right, course) : 0
    const allowed = (student: AssignmentStudent, course: Course) => isRepeatAllowed(course, student) && !constraints.some((constraint) => constraint.studentId === student.studentId && constraint.courseId === course.id && constraint.type === 'must_not_assign')
    const add = (student: AssignmentStudent, course: Course, rank: number | null, source: AssignmentResult['source'], explanation: string) => {
      assignments.push({ studentId: student.studentId, clusterId, courseId: course.id, rank, source, aiPriority: priorityForCourse(student, clusterId, course.id), explanation })
      enrollmentByCourse[course.id] += 1
      if (student.classId) classEnrollmentByCourse[course.id][student.classId] = (classEnrollmentByCourse[course.id][student.classId] ?? 0) + 1
      assigned.add(student.studentId)
    }

    const forced = constraints.filter((constraint) => constraint.type === 'must_assign').sort((left, right) => deterministicKey(`${clusterId}|forced|${left.studentId}`).localeCompare(deterministicKey(`${clusterId}|forced|${right.studentId}`)))
    for (const constraint of forced) {
      const student = students.find((entry) => entry.studentId === constraint.studentId)
      const course = courses.find((entry) => entry.id === constraint.courseId)
      if (!student || !course || !allowed(student, course) || enrollmentByCourse[course.id] >= course.capacity.maximum) throw new Error(`אילוץ חובה אינו ניתן לביצוע: ${constraint.studentId} / ${constraint.courseId}`)
      if (!assigned.has(student.studentId)) add(student, course, null, 'hard_constraint', `אילוץ קשיח: ${constraint.note}`)
    }

    const submitters = students.filter((student) => student.submission?.preferences.some((preference) => preference.clusterId === clusterId))
    const maxRank = Math.max(0, ...submitters.flatMap((student) => student.submission?.preferences.find((preference) => preference.clusterId === clusterId)?.rankings.map((ranking) => ranking.rank) ?? []))
    for (const phase of ['target', 'maximum'] as const) {
      for (let rank = 1; rank <= maxRank; rank += 1) {
        for (const course of courses) {
          const limit = phase === 'target' ? course.capacity.target : course.capacity.maximum
          const available = limit - enrollmentByCourse[course.id]
          if (available <= 0) continue
          const candidates = submitters.filter((student) => !assigned.has(student.studentId) && allowed(student, course) && student.submission?.preferences.find((preference) => preference.clusterId === clusterId)?.rankings.some((ranking) => ranking.rank === rank && ranking.courseId === course.id))
          const candidateCount = candidates.length
          for (let index = 0; index < available && candidates.length; index += 1) {
            candidates.sort((left, right) => {
              const priorityDifference = priorityValue[priorityForCourse(right, clusterId, course.id)] - priorityValue[priorityForCourse(left, clusterId, course.id)]
              const balanceDifference = balanceByClass ? classDifference(left, right, course) : 0
              return priorityDifference || balanceDifference || deterministicKey(`${clusterId}|${course.id}|${rank}|${phase}|${left.studentId}`).localeCompare(deterministicKey(`${clusterId}|${course.id}|${rank}|${phase}|${right.studentId}`))
            })
            const student = candidates.shift()!
            add(student, course, rank, 'ranked_choice', `בחירה בדירוג ${rank}; שלב ${phase === 'target' ? 'יעד' : 'מקסימום'}${balanceByClass ? '; איזון כיתות' : ''}`)
          }
          if (candidateCount > available) tieBreaks.push(`${clusterId}|${course.id}|${rank}|${phase}`)
        }
      }
    }

    const chooseFallback = (student: AssignmentStudent, label: string) => courses.filter((course) => enrollmentByCourse[course.id] < course.capacity.maximum && allowed(student, course)).map((course) => ({ course, gap: course.capacity.target - enrollmentByCourse[course.id], classCount: classCount(student, course), count: enrollmentByCourse[course.id], key: deterministicKey(`${clusterId}|${label}|${student.studentId}|${course.id}`) })).sort((left, right) => right.gap - left.gap || (balanceByClass ? left.classCount - right.classCount : 0) || left.count - right.count || left.key.localeCompare(right.key))[0]?.course
    for (const student of submitters.filter((entry) => !assigned.has(entry.studentId))) {
      const course = chooseFallback(student, 'fallback')
      if (course) add(student, course, null, 'fallback_submitter', 'שיבוץ משלים לאחר מיצוי הקורסים שדורגו')
      else warnings.push(`${student.displayLabel}: לא נמצא מקום פנוי במקבץ ${clusterId}`)
    }
    const nonSubmitters = students.filter((student) => !submitters.includes(student)).sort((left, right) => deterministicKey(`${clusterId}|non-submitter|${left.studentId}`).localeCompare(deterministicKey(`${clusterId}|non-submitter|${right.studentId}`)))
    for (const student of nonSubmitters.filter((entry) => !assigned.has(entry.studentId))) {
      const course = chooseFallback(student, 'non-submitter')
      if (course) add(student, course, null, 'fallback_non_submitter', 'שיבוץ לאחר מתן קדימות למגישים')
      else warnings.push(`${student.displayLabel}: לא נמצא מקום פנוי במקבץ ${clusterId}`)
    }
    for (const course of courses) {
      if (enrollmentByCourse[course.id] < course.capacity.minimum) warnings.push(`${course.label}: מתחת לקיבולת המינימום`)
      if (enrollmentByCourse[course.id] > course.capacity.maximum) warnings.push(`${course.label}: מעל לקיבולת המרבית`)
    }
  }
  return { assignments, enrollmentByCourse, warnings, tieBreaks }
}
