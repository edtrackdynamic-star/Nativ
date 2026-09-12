import { describe, expect, it } from 'vitest'
import { minimumRankingCount, rankingCountAfterCourseChange, validRankingCount } from './rankingPolicy'

describe('ranking count policy', () => {
  it('requires every course when a cluster has one or two courses', () => {
    expect(minimumRankingCount(1)).toBe(1)
    expect(minimumRankingCount(2)).toBe(2)
    expect(validRankingCount(1, 1)).toBe(true)
    expect(validRankingCount(2, 1)).toBe(false)
    expect(validRankingCount(2, 2)).toBe(true)
  })

  it('requires at least three rankings for larger clusters', () => {
    expect(minimumRankingCount(5)).toBe(3)
    expect(validRankingCount(3, 2)).toBe(false)
    expect(validRankingCount(5, 2)).toBe(false)
    expect(validRankingCount(5, 3)).toBe(true)
    expect(validRankingCount(5, 5)).toBe(true)
    expect(validRankingCount(5, 6)).toBe(false)
  })

  it('keeps full ranking as the default as courses are added or removed', () => {
    expect(rankingCountAfterCourseChange(1, 1, 2)).toBe(2)
    expect(rankingCountAfterCourseChange(2, 2, 3)).toBe(3)
    expect(rankingCountAfterCourseChange(3, 3, 5)).toBe(5)
    expect(rankingCountAfterCourseChange(5, 5, 4)).toBe(4)
  })

  it('preserves a coordinator-selected count while respecting the new minimum', () => {
    expect(rankingCountAfterCourseChange(5, 3, 6)).toBe(3)
    expect(rankingCountAfterCourseChange(5, 3, 4)).toBe(3)
    expect(rankingCountAfterCourseChange(5, 3, 2)).toBe(2)
  })
})
