import { useState } from 'react'
import { previewAssignmentChangeDelivery, sendAssignmentChangeDelivery, type ChangeAudience, type ChangeDeliveryPreview } from './firebaseApi'
import { useConfirmAction } from './interaction'
import { useReadOnly } from './readOnly'

const labels: Record<ChangeAudience, string> = { student: 'תלמידים ששיבוצם השתנה', instructor: 'מורי הקורסים שהושפעו', secretary: 'מזכירות' }

export function ChangeDelivery({ cycleId }: { cycleId: string }) {
  const { confirm, confirmation } = useConfirmAction()
  const readOnly = useReadOnly()
  const [audience, setAudience] = useState<ChangeAudience>('student')
  const [preview, setPreview] = useState<ChangeDeliveryPreview | null>(null)
  const [changeId, setChangeId] = useState('')
  const [changeOptions, setChangeOptions] = useState<ChangeDeliveryPreview['changes']>([])
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  async function load(next: ChangeAudience, selected = '') {
    if (pending) return
    setPending(true); setAudience(next); setChangeId(selected); setPreview(null); setMessage('')
    try { const result = await previewAssignmentChangeDelivery(cycleId, next, selected || undefined); setPreview(result); if (!selected) setChangeOptions(result.changes) }
    catch (error) { setMessage(error instanceof Error ? `לא ניתן להכין את רשימת העדכונים: ${error.message} רעננו את המחזור ונסו שוב.` : 'לא ניתן להכין את רשימת העדכונים. רעננו ונסו שוב.') }
    finally { setPending(false) }
  }
  async function send() {
    if (!preview || pending || !preview.messages.length || preview.skipped) return
    if (!await confirm(`להעביר לתור ${preview.messages.length} הודעות אל ${labels[audience]}? בדקו קודם את התוכן והנמענים.`)) return
    setPending(true)
    try {
      const result = await sendAssignmentChangeDelivery(cycleId, audience, preview, changeId || undefined)
      setMessage(result.alreadyQueued ? 'העדכונים האלה כבר הועברו לתור. רעננו את מצב המסירה.' : 'העדכונים הועברו לתור. רעננו בהמשך כדי לבדוק אם נמסרו.')
      try { const refreshed = await previewAssignmentChangeDelivery(cycleId, audience); setPreview(refreshed); setChangeId(''); setChangeOptions(refreshed.changes) }
      catch { setPreview(null); setMessage('העדכונים הועברו לתור, אך בדיקת מצב המסירה נכשלה. רעננו את המסך לפני פעולה נוספת.') }
    } catch (error) {
      setPreview(null)
      setMessage(error instanceof Error ? `השליחה לא הושלמה: ${error.message} טענו מחדש את התצוגה המקדימה ובדקו את מצב המסירה לפני ניסיון נוסף.` : 'השליחה לא הושלמה. בדקו את מצב המסירה ונסו שוב.')
    } finally { setPending(false) }
  }
  return <section className="workflow-section" aria-labelledby="change-delivery-title">
    <h3 id="change-delivery-title">עדכוני שינוי שיבוץ</h3>
    <p>כאן שולחים רק למי שהושפע משינוי שבוצע. המזכירות מקבלת עדכון אוטומטי; שליחה מכאן זמינה רק אם העדכון האוטומטי נכשל בלי שנמסר.</p>
    {confirmation}
    <div className="workspace-actions">{(['student', 'instructor', 'secretary'] as const).map((item) => <button key={item} type="button" className="secondary-action" aria-pressed={audience === item} disabled={pending} onClick={() => void load(item)}>{labels[item]}</button>)}</div>
    {changeOptions.length > 1 && <label>שינויים לשליחה<select disabled={pending} value={changeId} onChange={(event) => void load(audience, event.target.value)}><option value="">כל השינויים הממתינים</option>{changeOptions.map((change) => <option key={change.id} value={change.id}>{change.studentName} · {change.clusterLabel} · {change.afterCourseLabel}</option>)}</select></label>}
    <p role="status">{pending ? 'טוען…' : message}</p>
    {preview && <>
      <p>{preview.changes.length} שינויים ממתינים · {preview.messages.length} הודעות · {preview.skipped} נמענים ללא כתובת תקינה או גישה פעילה</p>
      {audience === 'secretary' && <p>{preview.autoHandled} שינויים מטופלים במשלוח האוטומטי{preview.needsReview ? ` · ${preview.needsReview} דורשים בירור לפני שליחה חוזרת` : ''}</p>}
      {(preview.delivery.sent || preview.delivery.queued || preview.delivery.failed || preview.delivery.unknown) > 0 && <p role="status">מצב משלוחים קודמים: נמסרו {preview.delivery.sent} · בתור {preview.delivery.queued} · נכשלו {preview.delivery.failed} · דורשים בירור {preview.delivery.unknown}</p>}
      {preview.changes.length > 0 && <ul>{preview.changes.map((change) => <li key={change.id}>{change.studentName} · {change.clusterLabel}: {change.beforeCourseLabel} ← {change.afterCourseLabel}</li>)}</ul>}
      <div className="delivery-preview">{preview.messages.map((mail, index) => <details key={`${mail.email}-${index}`}><summary>{mail.name} · {mail.email} · {mail.subject}</summary><p className="formatted-text">{mail.text}</p></details>)}</div>
      {preview.skipped > 0 && <p role="alert">השליחה נעצרה כי חסרה כתובת תקינה או גישה פעילה לחלק מהנמענים. תקנו את הפרטים באדטרק ובנתיב, ואז טענו מחדש את התצוגה המקדימה.</p>}
      <div className="workspace-actions"><button type="button" className="primary-action" disabled={readOnly || pending || !preview.messages.length || preview.skipped > 0} onClick={() => void send()}>שליחת עדכונים ל{labels[audience]}</button><button type="button" className="secondary-action" disabled={pending} onClick={() => void load(audience, changeId)}>רענון מצב</button></div>
    </>}
  </section>
}
