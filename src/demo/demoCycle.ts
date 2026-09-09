import type { Course, Cluster, CycleCatalogSnapshot } from '../domain/catalog'
import type { AssignmentCycle } from '../domain/cycle'
import type { PreferenceSubmission } from '../domain/preferences'

const baseMetadata = {
  organizationId: 'org-demo', version: 1,
  createdAt: '2026-08-27T10:00:00Z', createdBy: 'coordinator-demo',
  updatedAt: '2026-08-27T10:00:00Z', updatedBy: 'coordinator-demo',
}

export const demoCycle: AssignmentCycle = {
  ...baseMetadata,
  id: 'cycle-demo-2027-a',
  schoolYear: '2026-2027',
  termLabel: 'מחצית א׳',
  status: 'choice_open',
  choiceOpensAt: '2026-08-27T08:00:00Z',
  choiceClosesAt: '2026-09-03T20:00:00Z',
  appealWindowSchoolDays: 5,
  rulesVersion: '1.0.0',
}

export const demoClusters: Cluster[] = [
  { ...baseMetadata, id: 'cluster-arts', cycleId: demoCycle.id, label: 'אמנויות', slot: 'slot-a', eligibleGradeIds: ['grade-7'], displayOrder: 1, requiredRankingCount: 3, balanceByClass: false },
  { ...baseMetadata, id: 'cluster-tech', cycleId: demoCycle.id, label: 'טכנולוגיה ומדע', slot: 'slot-b', eligibleGradeIds: ['grade-7'], displayOrder: 2, requiredRankingCount: 3, balanceByClass: false },
]

function demoCourse(id: string, clusterId: string, logicalCourseId: string, label: string, subjectArea: string): Course {
  return {
    ...baseMetadata,
    id, cycleId: demoCycle.id, clusterId, logicalCourseId, label, description: `קורס הדגמה: ${label}`,
    subjectArea, instructorIds: [`teacher-${id}`], slot: clusterId === 'cluster-arts' ? 'slot-a' : 'slot-b',
    eligibleGradeIds: ['grade-7'], capacity: { minimum: 8, target: 18, maximum: 22 },
    repeatPolicy: 'allowed', published: true,
  }
}

export const demoCourses: Course[] = [
  demoCourse('course-theater', 'cluster-arts', 'theater', 'תיאטרון', 'אמנויות'),
  demoCourse('course-music', 'cluster-arts', 'music', 'מוזיקה', 'אמנויות'),
  demoCourse('course-art', 'cluster-arts', 'visual-art', 'אמנות חזותית', 'אמנויות'),
  demoCourse('course-robotics', 'cluster-tech', 'robotics', 'רובוטיקה', 'טכנולוגיה'),
  demoCourse('course-lab', 'cluster-tech', 'science-lab', 'מעבדת חקר', 'מדעים'),
  demoCourse('course-code', 'cluster-tech', 'coding', 'פיתוח משחקים', 'טכנולוגיה'),
]

export const demoCatalogSnapshot: CycleCatalogSnapshot = {
  ...baseMetadata,
  id: `catalog-${demoCycle.id}`,
  cycleId: demoCycle.id,
  clusters: demoClusters.map((cluster) => ({
    clusterId: cluster.id,
    label: cluster.label,
    requiredRankingCount: cluster.requiredRankingCount,
    balanceByClass: cluster.balanceByClass,
    courses: demoCourses
      .filter((course) => course.clusterId === cluster.id)
      .map((course) => ({ courseId: course.id, logicalCourseId: course.logicalCourseId, label: course.label })),
  })),
}

export const demoSubmission: PreferenceSubmission = {
  ...baseMetadata,
  id: 'submission-demo-1',
  cycleId: demoCycle.id,
  studentId: 'student-demo-001',
  submissionVersion: 1,
  status: 'submitted',
  source: 'nativ_app',
  submittedAt: '2026-08-28T09:00:00Z',
  catalogSnapshot: structuredClone(demoCatalogSnapshot.clusters),
  preferences: [
    { clusterId: 'cluster-arts', rankings: [{ courseId: 'course-theater', rank: 1 }, { courseId: 'course-music', rank: 2 }, { courseId: 'course-art', rank: 3 }] },
    { clusterId: 'cluster-tech', rankings: [{ courseId: 'course-robotics', rank: 1 }, { courseId: 'course-code', rank: 2 }, { courseId: 'course-lab', rank: 3 }], rationale: 'אני רוצה לבנות ולחקור' },
  ],
}
