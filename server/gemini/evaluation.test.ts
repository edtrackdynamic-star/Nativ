import { expect, it } from 'vitest'
import { evaluateWithGemini, hasExplicitRejection, isGeneralInterestOnly, parseEvaluations, sanitizeRationale } from './evaluation'
const input = [{ id: 'opaque-1', rationale: 'אני רוצה ללמוד ציור', clusterLabel: 'מקבץ בחירה', courses: [{ courseId: 'art', label: 'ציור', description: 'ציור ורישום', rank: 1 }, { courseId: 'science', label: 'מדעים', rank: 2 }] }]
const valid = [{ id: 'opaque-1', summary: 'עניין בציור', courses: [{ courseId: 'art', priority: 'medium', reason: 'עניין מפורש בציור' }, { courseId: 'science', priority: 'neutral', reason: 'לא נכתב קשר למדעים' }] }]
it('removes known names, class labels, email and phone from rationale', () => {
  const text = sanitizeRationale('שמי רוני לוי מכיתה ז׳1 roni@example.com 0501234567', ['רוני לוי', 'ז׳1'])
  for (const value of ['רוני', 'לוי', 'ז׳1', 'roni@example.com', '0501234567']) expect(text).not.toContain(value)
})
it('rejects missing, duplicate and foreign results', () => {
  expect(() => parseEvaluations([], input)).toThrow()
  expect(() => parseEvaluations([{ ...valid[0], id: 'other' }], input)).toThrow()
  expect(() => parseEvaluations([{ ...valid[0], courses: [{ courseId: 'art', priority: 'unknown', reason: 'x' }, valid[0].courses[1]] }], input)).toThrow()
  expect(() => parseEvaluations([{ ...valid[0], courses: [valid[0].courses[0]] }], input)).toThrow()
  expect(() => parseEvaluations([{ ...valid[0], courses: [valid[0].courses[0], { ...valid[0].courses[1], courseId: 'other' }] }], input)).toThrow()
  expect(() => parseEvaluations([{ ...valid[0], courses: [valid[0].courses[0], valid[0].courses[0]] }], input)).toThrow()
  expect(() => parseEvaluations([{ ...valid[0], courses: [{ ...valid[0].courses[0], priority: 'high' }, valid[0].courses[1]] }], [{ ...input[0], courses: [{ ...input[0].courses[0], rank: null }, input[0].courses[1]] }])).toThrow()
})
it('keeps general liking at medium even if the provider suggests high', () => {
  const general = [{ ...input[0], rationale: 'אני אוהבת יצירה ואמנות', courses: [{ ...input[0].courses[0], label: 'אמנות בקרטון', description: 'יצירת אמנות מקרטון ומחומר יומיומי' }, input[0].courses[1]] }]
  const proposed = [{ ...valid[0], courses: [{ courseId: 'art', priority: 'high', reason: 'תיאור הקורס כולל יצירת אמנות מקרטון' }, valid[0].courses[1]] }]
  expect(isGeneralInterestOnly(general[0].rationale)).toBe(true)
  expect(parseEvaluations(proposed, general)[0].courses[0]).toMatchObject({ priority: 'medium', reason: expect.stringContaining('עניין כללי') })
  expect(isGeneralInterestOnly('בניתי דגמים מקרטון ואני רוצה ללמוד לתכנן מבנה יציב')).toBe(false)
  expect(parseEvaluations(proposed, [{ ...general[0], rationale: 'בניתי דגמים מקרטון ואני רוצה ללמוד לתכנן מבנה יציב' }])[0].courses[0].priority).toBe('high')
})
it('keeps a negative priority only for an explicit student rejection', () => {
  const response = [{ ...valid[0], courses: [valid[0].courses[0], { courseId: 'science', priority: 'negative', reason: 'התלמיד מעדיף לא ללמוד מדעים' }] }]
  expect(hasExplicitRejection('אני אוהב רפואה ומעדיף לא פילאטיס')).toBe(true)
  expect(hasExplicitRejection('אני אוהב רפואה')).toBe(false)
  expect(parseEvaluations(response, [{ ...input[0], rationale: 'אני אוהב ציור ומעדיף לא מדעים' }])[0].courses[1].priority).toBe('negative')
  expect(parseEvaluations(response, input)[0].courses[1].priority).toBe('neutral')
  expect(() => parseEvaluations(response, [{ ...input[0], rationale: 'מעדיף לא מדעים', courses: [input[0].courses[0], { ...input[0].courses[1], rank: null }] }])).toThrow()
})
it('sends only the explicit anonymous payload and validates structured output', async () => {
  const fakeFetch: typeof fetch = async (_url, options) => {
    expect(options?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' })
    expect(String(options?.body)).not.toContain('studentId')
    expect(String(options?.body)).toContain('ציור')
    expect(String(options?.body)).toContain('מדעים')
    expect(String(options?.body)).toContain('general liking or interest')
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(valid) }] } }] }))
  }
  expect((await evaluateWithGemini('test-key', input, fakeFetch))[0].courses).toMatchObject([{ courseId: 'art', priority: 'medium' }, { courseId: 'science', priority: 'neutral' }])
})
it('does not echo provider error bodies or keys', async () => {
  await expect(evaluateWithGemini('secret', input, async () => new Response('secret provider details', { status: 403 }))).rejects.toThrow('שירות ההערכה אינו זמין')
})
