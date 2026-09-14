import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLastCoordinatorStage, readLastNavigation, saveLastCoordinatorStage, saveLastNavigation } from './navigationMemory'

describe('personal navigation memory', () => {
  const entries = new Map<string, string>()
  beforeEach(() => {
    entries.clear()
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the last area, cycle and stage separate for each user and organization', () => {
    saveLastNavigation('alice', 'school-a', { area: 'placement_coordinator', cycleId: 'cycle-1', coordinatorPage: 'workflow' })
    saveLastCoordinatorStage('alice', 'school-a', 'cycle-1', 'proposed')
    expect(readLastNavigation('alice', 'school-a')).toMatchObject({ area: 'placement_coordinator', cycleId: 'cycle-1', coordinatorPage: 'workflow' })
    expect(readLastCoordinatorStage('alice', 'school-a', 'cycle-1')).toBe('proposed')
    expect(readLastCoordinatorStage('alice', 'school-a', 'cycle-2')).toBeNull()
    expect(readLastNavigation('bob', 'school-a')).toEqual({})
    expect(readLastNavigation('alice', 'school-b')).toEqual({})
  })

  it('ignores malformed or obsolete stage values', () => {
    entries.set('nativ-navigation:school-a:alice', '{')
    expect(readLastNavigation('alice', 'school-a')).toEqual({})
    entries.set('nativ-navigation:school-a:alice', JSON.stringify({ stages: { 'cycle-1': 'unknown' } }))
    expect(readLastCoordinatorStage('alice', 'school-a', 'cycle-1')).toBeNull()
  })
})
