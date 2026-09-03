// Explicit egress contract: never pass workflow, appeal rationale or AI data.
export interface MailJob {
  notificationId: string
  audience: 'student' | 'secretary'
  studentId: string
  clusterLabel: string
  afterCourseLabel: string
  beforeCourseLabel?: string
  occurredAt: string
}

export interface DeliveryStore {
  claim(id: string): Promise<boolean>
  finish(id: string, status: 'sent' | 'delivery_unknown'): Promise<void>
}

export function canonicalEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email) ? email : null
}

export function recipientAllowed(audience: MailJob['audience'], member: Record<string, unknown> | undefined, access: Record<string, unknown> | undefined): boolean {
  if (member?.active !== true || member.isDemo === true || access?.active === false) return false
  return audience === 'student' ? member.role === 'student' : access?.active === true && Array.isArray(access.roles) && access.roles.includes('secretary')
}

export function renderMail(job: MailJob, student: { name: string; classLabel: string }): { subject: string; text: string } {
  const when = new Date(job.occurredAt)
  if (!Number.isFinite(when.getTime())) throw new Error('Invalid mail timestamp')
  const subject = job.audience === 'secretary' ? 'נתיב — שינוי שיבוץ שבוצע' : 'נתיב — השיבוץ שלך'
  const lines = job.audience === 'secretary'
    ? [`תלמיד/ה: ${student.name}`, `כיתה: ${student.classLabel}`, `מקבץ: ${job.clusterLabel}`, `לפני: ${job.beforeCourseLabel ?? 'לא צוין'}`, `אחרי: ${job.afterCourseLabel}`, `מועד הביצוע: ${when.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`]
    : [`מקבץ: ${job.clusterLabel}`, `השיבוץ שלך: ${job.afterCourseLabel}`]
  return { subject, text: [...lines, '', 'לצפייה בנתיב: https://edtrack-nativ.web.app/'].join('\n') }
}

// SMTP has no exactly-once protocol. Claim BEFORE sending and never retry an
// ambiguous send. A stale "sending" receipt needs manual reconciliation.
export async function deliverOnce(store: DeliveryStore, id: string, send: () => Promise<void>): Promise<void> {
  if (!await store.claim(id)) return
  try { await send() }
  catch { await store.finish(id, 'delivery_unknown'); return }
  // Failure here leaves "sending" and must not trigger another SMTP send.
  await store.finish(id, 'sent')
}
