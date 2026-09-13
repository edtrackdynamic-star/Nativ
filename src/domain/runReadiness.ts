import type { AssignmentRun } from './workflow'

export interface RunReadiness {
  required: number
  assigned: number
  missing: number
  excluded: number
  firstChoices: number
  issues: string[]
}

export function runReadiness(run: AssignmentRun): RunReadiness {
  const issues: string[] = []
  const required = run.includedStudentClusterCount
  const assigned = run.assignments.length
  if (!Number.isSafeInteger(required) || required === undefined || required < 1) issues.push('לא ניתן לאמת את מספר ההשתתפויות בהרצה זו. צרו הרצה חדשה.')
  const pairs = new Set<string>()
  for (const assignment of run.assignments) {
    const pair = `${assignment.studentId}|${assignment.clusterId}`
    if (pairs.has(pair)) issues.push('נמצא שיבוץ כפול של תלמיד באותו מקבץ.')
    pairs.add(pair)
  }
  const missing = typeof required === 'number' ? Math.max(0, required - pairs.size) : 0
  if (missing) issues.push(`חסרים ${missing} שיבוצים למשתתפים בהרצה.`)
  if (typeof required === 'number' && pairs.size > required) issues.push('נמצאו יותר שיבוצים ממספר המשתתפים בהרצה.')
  return { required: required ?? 0, assigned, missing, excluded: run.excludedStudentClusterCount ?? 0, firstChoices: run.assignments.filter(entry => entry.rank === 1).length, issues: [...new Set(issues)] }
}
