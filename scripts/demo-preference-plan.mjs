export const demoOrganizationId = 'masa-learning-demo'

function eligibleForClass(cluster, classId) {
  return cluster.eligibleClassIds === undefined || Boolean(classId && cluster.eligibleClassIds.includes(classId))
}

export function buildDemoPreferencePlan({ cycle, catalog, members, profiles, submissions, now }) {
  if (cycle.organizationId !== demoOrganizationId || catalog.organizationId !== demoOrganizationId || catalog.cycleId !== cycle.id) throw new Error('The cycle and catalog must belong to the demo school.')
  if (cycle.status !== 'choice_open' || cycle.choiceDeadlineEnabled && cycle.choiceClosesAt && cycle.choiceClosesAt <= now) throw new Error('The demo choice form is closed. Open or extend it before creating test preferences.')
  if (!Array.isArray(catalog.clusters) || !catalog.clusters.length) throw new Error('The demo cycle has no course clusters.')
  const activeStudents = members.filter((member) => member.active === true && member.role === 'student').sort((a, b) => a.id.localeCompare(b.id))
  if (activeStudents.some((member) => member.isDemo !== true)) throw new Error('A student account is not marked as demo data; no preferences were planned.')
  const alreadySubmitted = new Set(submissions.filter((submission) => submission.cycleId === cycle.id && submission.status === 'submitted').map((submission) => submission.studentId))
  const candidates = activeStudents.filter((member) => !alreadySubmitted.has(member.id)).map((member, index) => {
    const profile = profiles.get(member.id)
    const classId = profile?.classId ?? member.classIds?.[0]
    if (!classId) throw new Error('A demo student has no source class; no preferences were planned.')
    const clusters = catalog.clusters.filter((cluster) => eligibleForClass(cluster, classId))
    if (!clusters.length) throw new Error('A demo student has no eligible clusters; no preferences were planned.')
    const preferences = clusters.map((cluster, clusterIndex) => {
      if (cluster.rationaleMode === 'required') throw new Error('A cluster requires a personal explanation. Test preferences cannot invent one.')
      if (!Number.isInteger(cluster.requiredRankingCount) || cluster.requiredRankingCount < 1 || cluster.requiredRankingCount > cluster.courses.length || new Set(cluster.courses.map((course) => course.courseId)).size !== cluster.courses.length) throw new Error('A cluster has an invalid course ranking configuration.')
      const offset = (index + clusterIndex * 3) % cluster.courses.length
      const ordered = [...cluster.courses.slice(offset), ...cluster.courses.slice(0, offset)]
      return { clusterId: cluster.clusterId, rankings: ordered.slice(0, cluster.requiredRankingCount).map((course, rank) => ({ courseId: course.courseId, rank: rank + 1 })) }
    })
    return {
      id: `submission-${cycle.id}-${member.id}-v1`, organizationId: demoOrganizationId, cycleId: cycle.id,
      studentId: member.id, submissionVersion: 1, status: 'submitted', source: 'demo_seed',
      catalogSnapshot: structuredClone(clusters), preferences,
    }
  })
  return { activeStudentCount: activeStudents.length, alreadySubmittedCount: activeStudents.length - candidates.length, candidates }
}
