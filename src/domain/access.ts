export const roleIds = ['access_manager', 'placement_coordinator', 'appeal_reviewer', 'secretary', 'course_instructor', 'student'] as const
export type RoleId = (typeof roleIds)[number]

export interface AccessRole { id: RoleId; label: string; symbol: string; summary: string }

export const accessRoles: AccessRole[] = [
  { id: 'access_manager', label: 'מנהל גישה', symbol: 'מ', summary: 'מקצה תפקידים בלבד; ללא חשיפה מקצועית אוטומטית.' },
  { id: 'placement_coordinator', label: 'רכז שיבוץ', symbol: 'ר', summary: 'צופה בנתונים, מאשר הערכות ומבצע שיבוץ ושינויים.' },
  { id: 'appeal_reviewer', label: 'צוות ערעורים', symbol: 'ע', summary: 'בוחן מידע וניתוח השפעה ומגיש המלצה מנומקת.' },
  { id: 'secretary', label: 'מזכירות', symbol: 'ז', summary: 'מקבלת תיעוד של שינויים מאושרים לצורך תפעולי.' },
  { id: 'course_instructor', label: 'מנחה קורס', symbol: 'ק', summary: 'צופה בקורסים ובתלמידים המשויכים אליו בלבד.' },
]

export const capabilityIds = ['nativ.access.manage', 'nativ.assignment.view', 'nativ.assignment.manage', 'nativ.assignment.publish', 'nativ.ai.review', 'nativ.appeal.review', 'nativ.appeal.decide', 'nativ.capacity.override.approve', 'nativ.audit.view'] as const
export type CapabilityId = (typeof capabilityIds)[number]

export interface ActorContext { studentClassId?: string; uid: string; organizationId: string; roles: RoleId[]; capabilities: CapabilityId[] }

export function hasCapability(actor: ActorContext, capability: CapabilityId): boolean {
  return actor.capabilities.includes(capability)
}

export function canViewProfessionalPlacementData(actor: ActorContext): boolean {
  return hasCapability(actor, 'nativ.assignment.view')
}
