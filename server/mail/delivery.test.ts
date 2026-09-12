import { describe, expect, it } from 'vitest'
import { canonicalEmail, deliverOnce, recipientAllowed, renderMail, type DeliveryStore, type MailJob } from './delivery'

const job: MailJob = { notificationId: 'mail-1', audience: 'student', studentId: 'student-1', clusterLabel: 'אמנות', afterCourseLabel: 'מוזיקה', beforeCourseLabel: 'תיאטרון', occurredAt: '2026-09-03T09:00:00Z' }
function store() {
  const states = new Map<string, string>()
  const adapter: DeliveryStore = {
    async claim(id) { if (states.has(id)) return false; states.set(id, 'sending'); return true },
    async finish(id, status) { states.set(id, status) },
  }
  return { states, adapter }
}
describe('approved mail boundary', () => {
  it('requires an explicit active secretary role and active membership', () => {
    const member = { active: true, role: 'school_admin' }
    expect(recipientAllowed('secretary', member, { active: true, roles: ['access_manager'] })).toBe(false)
    expect(recipientAllowed('secretary', member, { active: true, roles: ['secretary'] })).toBe(true)
    expect(recipientAllowed('secretary', { active: true, role: 'staff' }, { active: true, roles: ['secretary'] })).toBe(true)
    expect(recipientAllowed('secretary', { active: true, role: 'student' }, { active: true, roles: ['secretary'] })).toBe(false)
    expect(recipientAllowed('secretary', { ...member, active: false }, { active: true, roles: ['secretary'] })).toBe(false)
    expect(recipientAllowed('secretary', member, { active: false, roles: ['secretary'] })).toBe(false)
  })
  it('rejects demo, inactive and non-student recipients of personal assignments', () => {
    expect(recipientAllowed('student', { active: true, role: 'student' }, undefined)).toBe(true)
    for (const member of [undefined, { active: false, role: 'student' }, { active: true, role: 'student', isDemo: true }, { active: true, role: 'teacher' }]) expect(recipientAllowed('student', member, undefined)).toBe(false)
    expect(recipientAllowed('student', { active: true, role: 'student' }, { active: false })).toBe(false)
  })
  it('sends only the new personal assignment to a student', () => {
    const text = renderMail({ ...job, rationale: 'SECRET', analysis: 'SECRET' } as MailJob, { name: 'PRIVATE NAME', classLabel: 'PRIVATE CLASS' }).text
    expect(text).toContain('מוזיקה')
    for (const forbidden of ['תיאטרון', 'PRIVATE', 'SECRET', 'student-1']) expect(text).not.toContain(forbidden)
  })
  it('includes approved operational fields for a secretary', () => {
    const text = renderMail({ ...job, audience: 'secretary' }, { name: 'שם לדוגמה', classLabel: 'ז1' }).text
    for (const expected of ['שם לדוגמה', 'ז1', 'אמנות', 'תיאטרון', 'מוזיקה', 'מועד הביצוע']) expect(text).toContain(expected)
  })
  it('renders one publication summary for secretaries without private rationale', () => {
    const content = renderMail({ ...job, audience: 'secretary', studentId: 'summary', results: [{ studentId: 'student-1', name: 'דנה', classLabel: 'ז1', clusterLabel: 'אמנות', courseLabel: 'מוזיקה', courseId: 'music' }] }, { name: '', classLabel: '' })
    expect(content.subject).toContain('השיבוץ פורסם')
    expect(content.text).toContain('דנה · ז1 · אמנות: מוזיקה')
    expect(content.text).not.toContain('student-1')
  })
  it('rejects multiple-recipient and header-injection addresses', () => {
    for (const input of ['a@b.com,b@c.com', 'a@b.com\r\nBcc: x@y.com', 'Name <a@b.com>', 'a@b.com;b@c.com']) expect(canonicalEmail(input)).toBeNull()
    expect(canonicalEmail(' A@B.COM ')).toBe('a@b.com')
  })
  it('sends once under concurrent and repeated event delivery', async () => {
    const { adapter, states } = store(); let sent = 0
    await Promise.all(Array.from({ length: 10 }, () => deliverOnce(adapter, 'same', async () => { sent++ })))
    expect(sent).toBe(1); expect(states.get('same')).toBe('sent')
  })
  it('does not retry an ambiguous SMTP failure', async () => {
    const { adapter, states } = store(); let attempts = 0
    const send = async () => { attempts++; throw new Error('timeout after DATA') }
    await deliverOnce(adapter, 'same', send); await deliverOnce(adapter, 'same', send)
    expect(attempts).toBe(1); expect(states.get('same')).toBe('delivery_unknown')
  })
  it('does not resend if recording SMTP acceptance fails', async () => {
    const { adapter, states } = store(); let sent = 0
    const failing = { ...adapter, async finish() { throw new Error('database unavailable') } }
    await expect(deliverOnce(failing, 'same', async () => { sent++ })).rejects.toThrow()
    await deliverOnce(adapter, 'same', async () => { sent++ })
    expect(sent).toBe(1); expect(states.get('same')).toBe('sending')
  })
})

it('limits staff delivery to active professional roles',()=>{
 expect(recipientAllowed('staff',{active:true,role:'student'},{active:true,roles:['placement_coordinator']})).toBe(false)
 expect(recipientAllowed('staff',{active:true,role:'teacher'},{active:true,roles:['access_manager']})).toBe(false)
 expect(recipientAllowed('staff',{active:true,role:'teacher'},{active:true,roles:['course_instructor']})).toBe(true)
})

it('renders one consolidated student message without staff-only names and classes',()=>{
 const content=renderMail({...job,results:[{studentId:'student-1',name:'שם לצוות',classLabel:'ז1',clusterLabel:'אמנות',courseLabel:'מוזיקה',courseId:'c1'},{studentId:'student-1',name:'שם לצוות',classLabel:'ז1',clusterLabel:'מדע',courseLabel:'רובוטיקה',courseId:'c2'}]},{name:'',classLabel:''})
 expect(content.text).toContain('אמנות: מוזיקה');expect(content.text).toContain('מדע: רובוטיקה');expect(content.text).not.toContain('שם לצוות');expect(content.text).not.toContain('ז1')
})
