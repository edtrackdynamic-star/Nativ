import { expect, it } from 'vitest'
import { missingSubmissionRequirements, rankingsComplete } from './preferenceState'

const clusters = [{ clusterId: 'c', label: 'מקבץ', requiredRankingCount: 1, courses: [{ courseId: 'a', logicalCourseId: 'a', label: 'קורס' }] }]
it('does not treat a single blank ranking or a foreign course as complete', () => {
  for (const courseId of ['', 'foreign']) expect(rankingsComplete(clusters, [{ clusterId: 'c', rankings: [{ courseId, rank: 1 }] }])).toBe(false)
  expect(rankingsComplete(clusters, [{ clusterId: 'c', rankings: [{ courseId: 'a', rank: 1 }] }])).toBe(true)
  expect(rankingsComplete([], [])).toBe(false)
})

it('identifies the cluster and a required explanation before submission', () => {
  const requiredClusters = [{ ...clusters[0], rationaleMode: 'required' as const }]
  expect(missingSubmissionRequirements(requiredClusters, [{ clusterId: 'c', rankings: [{ courseId: '', rank: 1 }] }])).toEqual([
    { clusterId: 'c', message: 'מקבץ: חסרות 1 בחירות.' },
    { clusterId: 'c', message: 'מקבץ: יש לכתוב הסבר לבחירה.' },
  ])
  expect(missingSubmissionRequirements(requiredClusters, [{ clusterId: 'c', rankings: [{ courseId: 'a', rank: 1 }], rationale: 'הנושא מעניין אותי' }])).toEqual([])
})
