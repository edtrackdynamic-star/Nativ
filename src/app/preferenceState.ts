import type { ClusterPreference, ClusterSnapshot } from '../domain/preferences'

export function rankingsComplete(clusters: ClusterSnapshot[], preferences: ClusterPreference[]): boolean {
  return clusters.length > 0 && clusters.every((cluster) => {
    const rankings = preferences.find((entry) => entry.clusterId === cluster.clusterId)?.rankings ?? []
    const available = new Set(cluster.courses.map((course) => course.courseId))
    return rankings.length === cluster.requiredRankingCount
      && new Set(rankings.map((entry) => entry.courseId)).size === rankings.length
      && rankings.every((entry, index) => available.has(entry.courseId) && entry.rank === index + 1)
  })
}

export function missingSubmissionRequirements(clusters: ClusterSnapshot[], preferences: ClusterPreference[]): { clusterId: string; message: string }[] {
  return clusters.flatMap((cluster) => {
    const preference = preferences.find((entry) => entry.clusterId === cluster.clusterId)
    const available = new Set(cluster.courses.map((course) => course.courseId))
    const rankings = preference?.rankings ?? []
    const selected = rankings.filter((entry) => available.has(entry.courseId))
    const missing = Math.max(0, cluster.requiredRankingCount - selected.length)
    const issues: { clusterId: string; message: string }[] = []
    if (missing) issues.push({ clusterId: cluster.clusterId, message: `${cluster.label}: חסרות ${missing} בחירות.` })
    if (selected.length !== new Set(selected.map((entry) => entry.courseId)).size) issues.push({ clusterId: cluster.clusterId, message: `${cluster.label}: אותו קורס נבחר יותר מפעם אחת.` })
    if (cluster.rationaleMode === 'required' && !preference?.rationale?.trim()) issues.push({ clusterId: cluster.clusterId, message: `${cluster.label}: יש לכתוב הסבר לבחירה.` })
    if (!issues.length && !rankingsComplete([cluster], preference ? [preference] : [])) issues.push({ clusterId: cluster.clusterId, message: `${cluster.label}: יש לבדוק את סדר הדירוגים.` })
    return issues
  })
}
