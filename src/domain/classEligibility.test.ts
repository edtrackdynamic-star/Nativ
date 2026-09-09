import { describe, expect, it } from 'vitest'
import { includesClass } from './classEligibility'
describe('class eligibility', () => {
  it('preserves unrestricted legacy clusters, including an unknown class', () => {
    expect(includesClass({}, 'a')).toBe(true)
    expect(includesClass({})).toBe(true)
  })
  it('admits only explicitly selected classes and fails closed for an empty selection', () => {
    expect(includesClass({eligibleClassIds:['a','b']}, 'b')).toBe(true)
    expect(includesClass({eligibleClassIds:['a']}, 'b')).toBe(false)
    expect(includesClass({eligibleClassIds:['a']})).toBe(false)
    expect(includesClass({eligibleClassIds:[]}, 'a')).toBe(false)
  })
})
