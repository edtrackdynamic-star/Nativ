const collections = {
  cycles: 'nativCycles',
  catalogSnapshots: 'nativCatalogSnapshots',
  submissions: 'nativSubmissions',
  auditEvents: 'nativAuditEvents',
  idempotency: 'nativIdempotency',
} as const

function segment(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`נדרש ${label}`)
  return encodeURIComponent(trimmed)
}

export function organizationDocumentPath(organizationId: string): string {
  return `organizations/${segment(organizationId, 'מזהה ארגון')}`
}

export function cycleDocumentPath(organizationId: string, cycleId: string): string {
  return `${organizationDocumentPath(organizationId)}/${collections.cycles}/${segment(cycleId, 'מזהה מחזור')}`
}

export function catalogSnapshotDocumentPath(organizationId: string, cycleId: string): string {
  return `${organizationDocumentPath(organizationId)}/${collections.catalogSnapshots}/${segment(cycleId, 'מזהה מחזור')}`
}

export function workflowDocumentPath(organizationId: string, cycleId: string): string {
  return `${organizationDocumentPath(organizationId)}/nativWorkflows/${cycleId}`
}

export function courseCatalogDocumentPath(organizationId: string, cycleId: string): string {
  return `${organizationDocumentPath(organizationId)}/nativCourseCatalogs/${cycleId}`
}

export function submissionDocumentPath(organizationId: string, submissionId: string): string {
  return `${organizationDocumentPath(organizationId)}/${collections.submissions}/${segment(submissionId, 'מזהה הגשה')}`
}

export function auditEventDocumentPath(organizationId: string, eventId: string): string {
  return `${organizationDocumentPath(organizationId)}/${collections.auditEvents}/${segment(eventId, 'מזהה אירוע ביקורת')}`
}

export function idempotencyDocumentPath(organizationId: string, key: string): string {
  return `${organizationDocumentPath(organizationId)}/${collections.idempotency}/${segment(key, 'מפתח פעולה')}`
}

export function organizationCollectionPath(organizationId: string, collection: keyof typeof collections): string {
  return `${organizationDocumentPath(organizationId)}/${collections[collection]}`
}
