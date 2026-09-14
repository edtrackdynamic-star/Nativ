import type { Course } from './catalog'

export interface ManualCapacityDecision {
  outcome: 'available' | 'over_maximum' | 'hard_limit'
  before: number
  after: number
  maximum: number
  limit?: number
}

export function manualCapacityDecision(course: Course, currentEnrollment: number): ManualCapacityDecision {
  const after = currentEnrollment + 1
  const capacity = course.capacity
  const details = { before: currentEnrollment, after, maximum: capacity.maximum, ...(capacity.limit === undefined ? {} : { limit: capacity.limit }) }
  if (capacity.limit !== undefined && after > capacity.limit) return { ...details, outcome: 'hard_limit' }
  if (after > capacity.maximum) return { ...details, outcome: 'over_maximum' }
  return { ...details, outcome: 'available' }
}
