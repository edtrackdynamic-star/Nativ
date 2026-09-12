import type { AssignmentCycle } from './cycle'

export function choiceDeadlinePassed(cycle: AssignmentCycle, now: string): boolean {
  return Boolean(cycle.choiceDeadlineEnabled && cycle.choiceClosesAt && Date.parse(now) >= Date.parse(cycle.choiceClosesAt))
}

export function choiceAcceptsResponses(cycle: AssignmentCycle, now: string): boolean {
  return cycle.status === 'choice_open' && !choiceDeadlinePassed(cycle, now)
}

export function isValidChoiceDeadline(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
