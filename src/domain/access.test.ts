import { describe, expect, it } from 'vitest'
import { canViewProfessionalPlacementData, type ActorContext } from './access'

describe('access boundaries', () => {
  it('does not expose placement data to an access manager by role name alone', () => {
    const actor: ActorContext = { uid: 'user-1', organizationId: 'org-1', roles: ['access_manager'], capabilities: ['nativ.access.manage'] }
    expect(canViewProfessionalPlacementData(actor)).toBe(false)
  })

  it('allows a multi-role coordinator when the explicit capability is present', () => {
    const actor: ActorContext = { uid: 'user-1', organizationId: 'org-1', roles: ['access_manager', 'placement_coordinator'], capabilities: ['nativ.access.manage', 'nativ.assignment.view'] }
    expect(canViewProfessionalPlacementData(actor)).toBe(true)
  })
})
