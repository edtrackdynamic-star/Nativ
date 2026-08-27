export type RationaleStrength = 'high' | 'medium' | 'neutral'

export interface AnonymousPreferenceInput {
  evaluationId: string
  clusterLabel: string
  rankings: Array<{ courseLabel: string; rank: number }>
  rationale?: string
}

export interface AiEvaluationOutput {
  evaluationId: string
  strength: RationaleStrength
  explanation: string
  recognizedCriteria: string[]
  providerVersion: string
}

export interface AiEvaluationProvider {
  evaluate(input: AnonymousPreferenceInput, idempotencyKey: string): Promise<AiEvaluationOutput>
}
