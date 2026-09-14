import { describe, expect, it } from 'vitest'
import type { Course } from './catalog'
import { manualCapacityDecision } from './manualCapacity'

const course = { capacity: { minimum: 0, target: 2, maximum: 3 } } as Course

describe('manual assignment capacity', () => {
  it('allows a manual placement within the ordinary maximum', () => {
    expect(manualCapacityDecision(course, 2)).toMatchObject({ outcome: 'available', before: 2, after: 3, maximum: 3 })
  })

  it('marks an ordinary maximum overrun for a short warning', () => {
    expect(manualCapacityDecision(course, 3)).toMatchObject({ outcome: 'over_maximum', before: 3, after: 4, maximum: 3 })
  })

  it('does not override a separately defined hard limit', () => {
    const limited = { ...course, capacity: { ...course.capacity, limit: 4 } }
    expect(manualCapacityDecision(limited, 3).outcome).toBe('over_maximum')
    expect(manualCapacityDecision(limited, 4).outcome).toBe('hard_limit')
    expect(manualCapacityDecision({ ...course, capacity: { ...course.capacity, limit: 3 } }, 3).outcome).toBe('hard_limit')
  })
})
