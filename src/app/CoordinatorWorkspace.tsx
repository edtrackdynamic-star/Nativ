import { useEffect, useState } from 'react'
import type { AssignmentCycle, CycleStatus } from '../domain/cycle'
import type { AuditEvent } from '../domain/types'
import { getCycle, listAuditEvents, transitionCycle } from './firebaseApi'

const statusLabels: Record<CycleStatus, string> = {
  draft: 'טיוטה', choice_open: 'בחירה פתוחה', choice_closed: 'בחירה סגורה', assignment: 'בתהליך שיבוץ',
  published: 'פורסם', appeals: 'תקופת ערעורים', closed: 'נסגר',
}

const actions: Partial<Record<CycleStatus, { to: CycleStatus; label: string; reason: string }>> = {
  draft: { to: 'choice_open', label: 'פתיחת הבחירה', reason: 'פתיחת הבחירה בידי רכז' },
  choice_open: { to: 'choice_closed', label: 'סגירת הבחירה', reason: 'סיום תקופת הבחירה' },
  choice_closed: { to: 'assignment', label: 'מעבר לשיבוץ', reason: 'הקלט מוכן להרצת שיבוץ' },
  assignment: { to: 'published', label: 'אישור ופרסום', reason: 'אישור תוצאת השיבוץ לפרסום' },
  published: { to: 'appeals', label: 'פתיחת ערעורים', reason: 'פתיחת חלון הערעורים' },
  appeals: { to: 'closed', label: 'סגירת המחזור', reason: 'סיום הטיפול בערעורים' },
}

async function loadWorkspace(cycleId: string) {
  const [cycle, audits] = await Promise.all([getCycle(cycleId), listAuditEvents()])
  return { cycle, audits }
}

export function CoordinatorWorkspace({ cycleId }: { cycleId: string }) {
  const [cycle, setCycle] = useState<AssignmentCycle | null>(null)
  const [audits, setAudits] = useState<AuditEvent[]>([])
  const [message, setMessage] = useState('טוען את לוח המחזור…')
  const [pending, setPending] = useState(false)

  async function refresh() {
    const loaded = await loadWorkspace(cycleId)
    setCycle(loaded.cycle)
    setAudits(loaded.audits)
    setMessage('הנתונים נטענו מ־Firestore Emulator.')
  }

  useEffect(() => {
    let active = true
    void loadWorkspace(cycleId).then((loaded) => {
      if (!active) return
      setCycle(loaded.cycle)
      setAudits(loaded.audits)
      setMessage('הנתונים נטענו מ־Firestore Emulator.')
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : 'טעינת המחזור נכשלה')
    })
    return () => { active = false }
  }, [cycleId])

  async function runAction() {
    if (!cycle || pending) return
    const action = actions[cycle.status]
    if (!action) return
    try {
      setPending(true)
      const updated = await transitionCycle(cycle, action.to, action.reason)
      setCycle(updated)
      setAudits(await listAuditEvents())
      setMessage(`הפעולה “${action.label}” בוצעה ותועדה בשרת.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'הפעולה נכשלה') }
    finally { setPending(false) }
  }

  if (!cycle) return <section className="workspace-card"><p aria-live="polite">{message}</p></section>
  const action = actions[cycle.status]
  return (
    <section className="workspace-card" aria-labelledby="coordinator-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">אזור רכז שיבוץ</span><h2 id="coordinator-title">לוח המחזור</h2></div>
        <span className="status-pill">{statusLabels[cycle.status]}</span>
      </div>
      <p className="workspace-message" aria-live="polite">{message}</p>
      <dl className="workspace-metrics">
        <div><dt>שנת לימודים</dt><dd>{cycle.schoolYear}</dd></div>
        <div><dt>גרסת מחזור</dt><dd>{cycle.version}</dd></div>
        <div><dt>אירועי ביקורת</dt><dd>{audits.length}</dd></div>
        <div><dt>חלון ערעורים</dt><dd>{cycle.appealWindowSchoolDays} ימי לימודים</dd></div>
      </dl>
      <div className="workspace-actions">
        {action ? <button type="button" className="primary-action" disabled={pending} onClick={() => void runAction()}>{pending ? 'מבצע…' : action.label}</button> : <strong className="cycle-complete">המחזור הושלם</strong>}
        <button type="button" className="secondary-action" onClick={() => void refresh()}>רענון נתונים</button>
      </div>
      <div className="audit-preview">
        <h3>פעולות אחרונות</h3>
        {audits.length ? <ol>{audits.slice(0, 5).map((event) => <li key={event.id}><strong>{event.action}</strong><span>{new Date(event.occurredAt).toLocaleString('he-IL')}</span><small>{event.reason}</small></li>)}</ol> : <p>עדיין לא נרשמו פעולות.</p>}
      </div>
    </section>
  )
}
