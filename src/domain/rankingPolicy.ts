export function minimumRankingCount(courseCount: number): number {
  return Math.min(3, courseCount)
}

export function validRankingCount(courseCount: number, count: number): boolean {
  return Number.isInteger(courseCount) && courseCount > 0
    && Number.isInteger(count) && count >= minimumRankingCount(courseCount) && count <= courseCount
}

export function rankingCountAfterCourseChange(previousCourseCount: number, previousRankingCount: number, nextCourseCount: number): number {
  if (!Number.isInteger(previousRankingCount)) return nextCourseCount
  if (previousRankingCount === previousCourseCount) return nextCourseCount
  return Math.max(minimumRankingCount(nextCourseCount), Math.min(previousRankingCount, nextCourseCount))
}
