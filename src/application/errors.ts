export class AuthorizationError extends Error {
  constructor(message = 'אין הרשאה לבצע את הפעולה') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

export class EntityNotFoundError extends Error {
  constructor(entityType: string, entityId: string) {
    super(`${entityType} לא נמצא: ${entityId}`)
    this.name = 'EntityNotFoundError'
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('מפתח הפעולה כבר שימש לבקשה אחרת')
    this.name = 'IdempotencyConflictError'
  }
}
