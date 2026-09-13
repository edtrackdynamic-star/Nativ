import { describe, expect, it } from 'vitest'
import { initialLoginSchoolId } from './loginSchool'

describe('school-scoped login links', () => {
  it('uses only the explicitly linked school', () => {
    expect(initialLoginSchoolId('?school=masa-learning-demo')).toBe('masa-learning-demo')
    expect(initialLoginSchoolId('?school=Democratic-Wizo')).toBe('democratic-wizo')
  })

  it('does not silently choose another school', () => {
    expect(initialLoginSchoolId('')).toBe('')
    expect(initialLoginSchoolId('?school=%2Fusers%2Fsecret')).toBe('')
  })
})
