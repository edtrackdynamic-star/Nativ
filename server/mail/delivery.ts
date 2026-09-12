// Explicit egress contract: never pass workflow, appeal rationale or AI data.
export interface MailJob {
  notificationId: string
  audience: 'student' | 'secretary' | 'staff' | 'instructor_change' | 'incident'
  recipientId?: string
  recipientIds?: string[]
  courseId?: string
  results?: Array<{studentId:string;name:string;classLabel:string;clusterLabel:string;courseLabel:string;courseId:string}>
  studentId: string
  clusterLabel: string
  afterCourseLabel: string
  beforeCourseLabel?: string
  occurredAt: string
  changeLines?: Array<{ studentName: string; classLabel: string; clusterLabel: string; beforeCourseLabel: string; afterCourseLabel: string; direction: 'student' | 'left' | 'joined' | 'moved' | 'secretary' }>
  relatedCourseIds?: string[]
  incident?: { id: string; action: string; category: string }
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
  if (audience === 'instructor_change') return ['teacher', 'school_admin'].includes(String(member.role))
  if(audience==='staff')return access?.active===true && Array.isArray(access.roles) && (
    (['teacher','staff','school_admin'].includes(String(member.role)) && access.roles.includes('secretary')) ||
    (['teacher','school_admin'].includes(String(member.role)) && access.roles.some(r=>['placement_coordinator','course_instructor'].includes(r)))
  )
  return audience === 'student' ? member.role === 'student' : ['teacher','staff','school_admin'].includes(String(member.role)) && access?.active === true && Array.isArray(access.roles) && access.roles.includes('secretary')
}

export function renderMail(job: MailJob, student: { name: string; classLabel: string }): { subject: string; text: string } {
  const when = new Date(job.occurredAt)
  if (!Number.isFinite(when.getTime())) throw new Error('Invalid mail timestamp')
  if (job.audience === 'incident' && job.incident) {
    const actions: Record<string, string> = { mail_delivery: 'שליחת הודעות', preview_assignment_change_delivery: 'הכנת עדכון שיבוץ', send_assignment_change_delivery: 'שליחת עדכון שיבוץ', execute_appeal_change: 'ביצוע שינוי לאחר ערעור', change_student_assignment: 'שינוי שיבוץ תלמיד' }
    const categories: Record<string, string> = { smtp_connection: 'שירות הדואר אינו זמין', mail_configuration: 'הגדרות הדואר דורשות בדיקה', retry_limit: 'המשלוח לא הושלם', server_failure: 'תקלה במערכת' }
    return { subject: 'נתיב — תקלה מערכתית הדורשת בדיקה', text: [`פעולה: ${actions[job.incident.action] ?? 'פעולה בנתיב'}`, `סוג תקלה: ${categories[job.incident.category] ?? 'תקלה במערכת'}`, `מועד: ${when.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`, `מזהה אירוע: ${job.incident.id}`, 'בדקו את מצב הפעולה ואת יומן התקלות בנתיב.'].join('\n') }
  }
  if (job.changeLines?.length) {
    const subject = job.audience === 'student' ? 'נתיב — עדכון השיבוץ שלך' : job.audience === 'secretary' ? 'נתיב — עדכוני שיבוץ' : 'נתיב — שינוי תלמידים בקורס'
    const rows = job.changeLines.map((line) => {
      if (job.audience === 'student') return `${line.clusterLabel}: ${line.beforeCourseLabel} ← ${line.afterCourseLabel}`
      const person = `${line.studentName} · ${line.classLabel} · ${line.clusterLabel}`
      if (job.audience === 'secretary' || line.direction === 'moved') return `${person}: ${line.beforeCourseLabel} ← ${line.afterCourseLabel}`
      return line.direction === 'left' ? `${person}: יצא/ה מהקורס ${line.beforeCourseLabel}` : `${person}: הצטרף/ה לקורס ${line.afterCourseLabel}`
    })
    return { subject, text: [...rows, '', 'לצפייה בנתיב: https://edtrack-nativ.web.app/'].join('\n') }
  }
  if(job.results?.length){
    const subject=job.audience==='staff'?'נתיב — תוצאות השיבוץ':job.audience==='secretary'?'נתיב — השיבוץ פורסם':'נתיב — השיבוצים שלך'
    const rows=job.results.map(row=>job.audience==='student'?`${row.clusterLabel}: ${row.courseLabel}`:`${row.name} · ${row.classLabel} · ${row.clusterLabel}: ${row.courseLabel}`)
    return {subject,text:[...rows,'','לצפייה בנתיב: https://edtrack-nativ.web.app/'].join('\n')}
  }
  const subject = job.audience === 'staff' ? 'נתיב — תוצאות השיבוץ' : job.audience === 'secretary' ? 'נתיב — שינוי שיבוץ שבוצע' : 'נתיב — השיבוץ שלך'
  const lines = job.audience === 'staff' ? [`תלמיד/ה: ${student.name}`,`כיתה: ${student.classLabel}`,`מקבץ: ${job.clusterLabel}`,`קורס: ${job.afterCourseLabel}`] : job.audience === 'secretary'
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
