import { expect, it } from 'vitest'
import type { AiEvaluation } from './workflow'
import { needsIndividualAiReview } from './aiReview'

const evaluation: AiEvaluation = {
  id: 'e', anonymousStudentRef: 'anon-e', studentId: 's', clusterId: 'c', sourceSubmissionId: 'sub', sourceSubmissionVersion: 1,
  input: { rationale: 'אני אוהבת אמנות', rankings: [{ courseId: 'art', rank: 1 }, { courseId: 'science', rank: 2 }], courses: [{ courseId: 'art', label: 'אמנות', rank: 1 }, { courseId: 'science', label: 'מדעים', rank: 2 }] },
  raw: { priority: 'medium', summary: 'עניין באמנות', model: 'test', evaluatedAt: 'now', coursePriorities: [{ courseId: 'art', priority: 'medium', reason: 'עניין מפורש' }, { courseId: 'science', priority: 'neutral', reason: 'אין קשר' }] },
}

it('keeps clear single-course interest outside the exception queue', () => {
  expect(needsIndividualAiReview(evaluation)).toBe(false)
})

it('requires individual review for unclear, strong or legacy recommendations', () => {
  expect(needsIndividualAiReview({ ...evaluation, raw: { ...evaluation.raw, coursePriorities: undefined } })).toBe(true)
  expect(needsIndividualAiReview({ ...evaluation, raw: { ...evaluation.raw, coursePriorities: evaluation.raw.coursePriorities!.map((entry) => ({ ...entry, priority: 'neutral' })) } })).toBe(true)
  expect(needsIndividualAiReview({ ...evaluation, raw: { ...evaluation.raw, coursePriorities: [{ courseId: 'art', priority: 'high', reason: 'x' }, evaluation.raw.coursePriorities![1]] } })).toBe(true)
  expect(needsIndividualAiReview({ ...evaluation, raw: { ...evaluation.raw, coursePriorities: [{ courseId: 'art', priority: 'medium', reason: 'x' }, { courseId: 'science', priority: 'medium', reason: 'x' }] } })).toBe(true)
})

it('does not require individual review for neutral submissions without a rationale', () => {
  expect(needsIndividualAiReview({ ...evaluation, input: { ...evaluation.input, rationale: undefined }, raw: { ...evaluation.raw, coursePriorities: evaluation.raw.coursePriorities!.map((entry) => ({ ...entry, priority: 'neutral' })) } })).toBe(false)
})
