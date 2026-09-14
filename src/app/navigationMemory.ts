import type { RoleId } from '../domain/access'
import { coordinatorStageIds, type CoordinatorStageId } from './coordinatorStages'

export interface LastNavigation {
  area?: RoleId
  cycleId?: string | null
  coordinatorPage?: 'form' | 'workflow'
  showArchive?: boolean
  stages?: Record<string, CoordinatorStageId>
}

const key = (uid: string, organizationId: string) => `nativ-navigation:${organizationId}:${uid}`

export function readLastNavigation(uid: string, organizationId: string): LastNavigation {
  try {
    const value = JSON.parse(window.localStorage.getItem(key(uid, organizationId)) ?? '{}') as LastNavigation
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

export function saveLastNavigation(uid: string, organizationId: string, patch: Partial<LastNavigation>) {
  try {
    window.localStorage.setItem(key(uid, organizationId), JSON.stringify({ ...readLastNavigation(uid, organizationId), ...patch }))
  } catch { /* Navigation remains usable when browser storage is unavailable. */ }
}

export function readLastCoordinatorStage(uid: string, organizationId: string, cycleId: string): CoordinatorStageId | null {
  const stored = readLastNavigation(uid, organizationId).stages?.[cycleId]
  return coordinatorStageIds.find(stage => stage === stored) ?? null
}

export function saveLastCoordinatorStage(uid: string, organizationId: string, cycleId: string, stage: CoordinatorStageId) {
  const stages = readLastNavigation(uid, organizationId).stages ?? {}
  saveLastNavigation(uid, organizationId, { stages: { ...stages, [cycleId]: stage } })
}
