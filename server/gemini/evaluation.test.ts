import { expect, it } from 'vitest'
import { evaluateWithGemini, parseEvaluations, sanitizeRationale } from './evaluation'
const input = [{ id: 'opaque-1', rationale: 'אני רוצה ללמוד ציור', rankings: [1, 2] }]
it('removes known names, class labels, email and phone from rationale', () => {
  const text = sanitizeRationale('שמי רוני לוי מכיתה ז׳1 roni@example.com 0501234567', ['רוני לוי', 'ז׳1'])
  for (const value of ['רוני', 'לוי', 'ז׳1', 'roni@example.com', '0501234567']) expect(text).not.toContain(value)
})
it('rejects missing, duplicate and foreign results', () => {
  expect(() => parseEvaluations([], input)).toThrow()
  expect(() => parseEvaluations([{ id: 'other', priority: 'high', summary: 'x' }], input)).toThrow()
  expect(() => parseEvaluations([{ id: 'opaque-1', priority: 'unknown', summary: 'x' }], input)).toThrow()
})
it('sends only the explicit anonymous payload and validates structured output', async () => {
  const fakeFetch: typeof fetch = async (_url, options) => {
    expect(options?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' })
    expect(String(options?.body)).not.toContain('studentId')
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify([{ id: 'opaque-1', priority: 'medium', summary: 'עניין בציור' }]) }] } }] }))
  }
  expect(await evaluateWithGemini('test-key', input, fakeFetch)).toHaveLength(1)
})
it('does not echo provider error bodies or keys', async () => {
  await expect(evaluateWithGemini('secret', input, async () => new Response('secret provider details', { status: 403 }))).rejects.toThrow('שירות ההערכה אינו זמין')
})
