import type { AiEvaluationOutput, AiEvaluationProvider, AnonymousPreferenceInput } from './AiEvaluationProvider'

export class MockAiEvaluationProvider implements AiEvaluationProvider {
  async evaluate(input: AnonymousPreferenceInput): Promise<AiEvaluationOutput> {
    const hasRationale = Boolean(input.rationale?.trim())
    return {
      evaluationId: input.evaluationId,
      strength: hasRationale ? 'medium' : 'neutral',
      explanation: hasRationale ? 'פלט הדגמה מקומי בלבד; לא בוצעה קריאה לשירות AI.' : 'לא נכתב נימוק ולכן ההערכה ניטרלית.',
      recognizedCriteria: [],
      providerVersion: 'mock-v1',
    }
  }
}
