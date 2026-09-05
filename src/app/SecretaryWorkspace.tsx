import { useEffect, useMemo, useState } from 'react'
import type { WorkflowState } from '../domain/workflow'
import { getWorkflow } from './firebaseApi'

const deliveryLabels = { queued_mock: 'טרם נשלחה', available: 'זמינה במערכת', queued: 'ממתינה לשליחה', sent: 'נשלחה', failed: 'השליחה נכשלה', delivery_unknown: 'נדרשת בדיקת מסירה' }

export function SecretaryWorkspace({ cycleId }: { cycleId: string }) {
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null)
  const [message, setMessage] = useState('טוען דיווחים…')
  async function refresh() { const value = await getWorkflow(cycleId, 'secretary'); setWorkflow(value); setMessage('הדיווחים מעודכנים.') }
  useEffect(() => { let active = true; void getWorkflow(cycleId, 'secretary').then((value) => { if (active) { setWorkflow(value); setMessage('הדיווחים מעודכנים.') } }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'הטעינה נכשלה') }); return () => { active = false } }, [cycleId])
  const changes = useMemo(() => {
    const groups = new Map<string, NonNullable<WorkflowState['notifications']>>()
    for (const notification of workflow?.notifications ?? []) {
      const key = `${notification.subject}|${notification.body}|${notification.createdAt}`
      groups.set(key, [...(groups.get(key) ?? []), notification])
    }
    return [...groups.values()]
  }, [workflow])
  return <section className="workspace-card" aria-labelledby="secretary-title"><div className="workspace-heading"><div><span className="eyebrow">אזור מזכירות</span><h2 id="secretary-title">שינויי שיבוץ שבוצעו</h2></div></div><p className="workspace-message" aria-live="polite">{message}</p><div className="access-table">{changes.length ? changes.map((group) => <article key={`${group[0].id}`}><div><strong>{group[0].subject}</strong><small>{new Date(group[0].createdAt).toLocaleString('he-IL')}</small></div><div><p>{group[0].body}</p><small>{group.map((notification) => `${notification.channel === 'email' ? 'דוא״ל' : 'מערכת'}: ${deliveryLabels[notification.status]}`).join(' · ')}</small></div></article>) : <p>אין שינויי שיבוץ חדשים.</p>}</div><div className="workspace-actions"><button type="button" className="secondary-action" onClick={() => void refresh()}>רענון</button></div></section>
}
