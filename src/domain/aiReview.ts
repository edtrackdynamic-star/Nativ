import type { AiEvaluation } from './workflow'

export function needsIndividualAiReview(evaluation: AiEvaluation): boolean {
  if (!evaluation.raw.coursePriorities || !evaluation.input.courses) return true
  const ranked = evaluation.input.courses.filter((course) => course.rank !== null)
  if (ranked.length !== evaluation.input.rankings.length) return true
  const priorities = ranked.map((course) => evaluation.raw.coursePriorities?.find((entry) => entry.courseId === course.courseId)?.priority)
  if (priorities.some((priority) => !priority)) return true
  const emphasized = priorities.filter((priority) => priority !== 'neutral')
  if (!evaluation.input.rationale?.trim()) return emphasized.length !== 0
  return emphasized.length !== 1 || emphasized[0] === 'high'
}
