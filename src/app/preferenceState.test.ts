import { expect, it } from 'vitest'
import { rankingsComplete } from './preferenceState'

const clusters = [{ clusterId: 'c', label: 'מקבץ', requiredRankingCount: 1, courses: [{ courseId: 'a', logicalCourseId: 'a', label: 'קורס' }] }]
it('does not treat a single blank ranking or a foreign course as complete', () => {
  for (const courseId of ['', 'foreign']) expect(rankingsComplete(clusters, [{ clusterId: 'c', rankings: [{ courseId, rank: 1 }] }])).toBe(false)
  expect(rankingsComplete(clusters, [{ clusterId: 'c', rankings: [{ courseId: 'a', rank: 1 }] }])).toBe(true)
  expect(rankingsComplete([], [])).toBe(false)
})
