/** Missing restriction includes all classes; an explicit empty list includes none. */
export function includesClass(scope: { eligibleClassIds?: string[] }, classId?: string): boolean {
  return scope.eligibleClassIds === undefined || Boolean(classId && scope.eligibleClassIds.includes(classId))
}
