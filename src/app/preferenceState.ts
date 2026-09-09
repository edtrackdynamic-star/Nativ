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
