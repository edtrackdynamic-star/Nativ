import { useState } from 'react'
import { NativCommandService } from '../application/NativCommandService'
import type { ActorContext } from '../domain/access'
import type { AssignmentCycle, CycleStatus } from '../domain/cycle'
import { demoCatalogSnapshot } from '../demo/demoCycle'
import { InMemoryNativRepository } from '../infrastructure/local/InMemoryNativRepository'

interface AdminCyclePanelProps {
  initialCycle: AssignmentCycle
}

const coordinator: ActorContext = {
  uid: 'coordinator-demo',
  organizationId: 'org-demo',
  roles: ['access_manager', 'placement_coordinator'],
  capabilities: ['nativ.access.manage', 'nativ.assignment.view', 'nativ.assignment.manage', 'nativ.audit.view'],
}

const statusLabels: Record<CycleStatus, string> = {
  draft: 'טיוטה',
  choice_open: 'בחירה פתוחה',
  choice_closed: 'בחירה סגורה',
  assignment: 'בתהליך שיבוץ',
  published: 'פורסם',
  appeals: 'תקופת ערעורים',
  closed: 'נסגר',
}

const nextActions: Partial<Record<CycleStatus, { to: CycleStatus; label: string; reason: string }>> = {
  draft: { to: 'choice_open', label: 'פתיחת הבחירה', reason: 'פתיחת מחזור ההדגמה לבחירה' },
  choice_open: { to: 'choice_closed', label: 'סגירת הבחירה', reason: 'סיום תקופת הבחירה במחזור ההדגמה' },
  choice_closed: { to: 'assignment', label: 'מעבר לשיבוץ', reason: 'הקלט מוכן להרצת שיבוץ' },
  assignment: { to: 'published', label: 'אישור תוצאה', reason: 'אישור תוצאת ההדגמה לפרסום' },
  published: { to: 'appeals', label: 'פתיחת ערעורים', reason: 'פתיחת חלון הערעורים המאושר' },
  appeals: { to: 'closed', label: 'סגירת המחזור', reason: 'סיום הטיפול בערעורים' },
}

export function AdminCyclePanel({ initialCycle }: AdminCyclePanelProps) {
  const [service] = useState(() => new NativCommandService(new InMemoryNativRepository({ cycles: [initialCycle], catalogSnapshots: [demoCatalogSnapshot] })))
  const [cycle, setCycle] = useState(initialCycle)
  const [auditCount, setAuditCount] = useState(0)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('כל הפעולות במסך זה נשמרות בזיכרון המקומי בלבד.')
  const action = nextActions[cycle.status]

  async function runNextAction() {
    if (!action || pending) return
    setPending(true)
    try {
      const occurredAt = new Date().toISOString()
      const updated = await service.transitionCycle(coordinator, {
        organizationId: cycle.organizationId,
        cycleId: cycle.id,
        expectedVersion: cycle.version,
        to: action.to,
        reason: action.reason,
        occurredAt,
        idempotencyKey: `demo-cycle-${cycle.id}-${cycle.version}-${action.to}`,
        auditEventId: `demo-audit-${cycle.id}-${cycle.version}-${action.to}`,
      })
      setCycle(updated)
      const audits = await service.listAuditEvents(coordinator)
      setAuditCount(audits.length)
      setMessage(`הפעולה “${action.label}” הושלמה ותועדה ביומן המקומי.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'הפעולה נכשלה')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="admin-cycle-panel" aria-labelledby="admin-cycle-title">
      <div>
        <span className="eyebrow">מסך ניהול ראשון</span>
        <h2 id="admin-cycle-title">ניהול מחזור {cycle.schoolYear} · {cycle.termLabel}</h2>
        <p aria-live="polite">{message}</p>
      </div>
      <dl className="admin-cycle-metrics">
        <div><dt>מצב נוכחי</dt><dd>{statusLabels[cycle.status]}</dd></div>
        <div><dt>גרסה</dt><dd>{cycle.version}</dd></div>
        <div><dt>אירועי ביקורת</dt><dd>{auditCount}</dd></div>
      </dl>
      <div className="admin-cycle-actions">
        {action ? (
          <button type="button" onClick={runNextAction} disabled={pending}>
            {pending ? 'מבצע…' : action.label}
          </button>
        ) : (
          <span className="cycle-complete">המחזור הושלם</span>
        )}
        <small>הפעולה דורשת capability של רכז שיבוץ ונבדקת בשכבת היישום.</small>
      </div>
    </section>
  )
}
