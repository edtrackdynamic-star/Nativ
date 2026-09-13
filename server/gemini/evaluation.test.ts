import { expect, it } from 'vitest'
import { evaluateWithGemini, parseEvaluations, sanitizeRationale } from './evaluation'
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
it('sends only the explicit anonymous payload and validates structured output', async () => {
  const fakeFetch: typeof fetch = async (_url, options) => {
    expect(options?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' })
    expect(String(options?.body)).not.toContain('studentId')
    expect(String(options?.body)).toContain('ציור')
    expect(String(options?.body)).toContain('מדעים')
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(valid) }] } }] }))
  }
  expect((await evaluateWithGemini('test-key', input, fakeFetch))[0].courses).toMatchObject([{ courseId: 'art', priority: 'medium' }, { courseId: 'science', priority: 'neutral' }])
})
it('does not echo provider error bodies or keys', async () => {
  await expect(evaluateWithGemini('secret', input, async () => new Response('secret provider details', { status: 403 }))).rejects.toThrow('שירות ההערכה אינו זמין')
})
