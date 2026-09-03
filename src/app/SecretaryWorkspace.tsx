import { useEffect, useState } from 'react'
import type { WorkflowState } from '../domain/workflow'
import { getWorkflow } from './firebaseApi'

const deliveryLabels = { queued_mock: 'טרם נשלחה', available: 'זמין לצפייה', queued: 'ממתינה לשליחה', sent: 'נמסרה לשרת הדואר', failed: 'לא נשלחה — יש לפנות לרכז השיבוץ', delivery_unknown: 'המסירה דורשת בדיקה מול רכז השיבוץ' }

export function SecretaryWorkspace({ cycleId }: { cycleId: string }) {
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null)
  const [message, setMessage] = useState('טוען דיווחים…')
  useEffect(() => { void getWorkflow(cycleId).then((value) => { setWorkflow(value); setMessage('דיווחי המזכירות נטענו.') }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'הטעינה נכשלה')) }, [cycleId])
  return <section className="workspace-card" aria-labelledby="secretary-title"><div className="workspace-heading"><div><span className="eyebrow">אזור מזכירות</span><h2 id="secretary-title">שינויי שיבוץ לביצוע תפעולי</h2></div><span className="status-pill">אפליקציה + מייל</span></div><p className="workspace-message" aria-live="polite">{message}</p><div className="access-table">{workflow?.notifications.length ? workflow.notifications.map((notification) => <article key={notification.id}><div><strong>{notification.subject}</strong><small>{notification.channel === 'email' ? 'דוא״ל' : 'הודעה באפליקציה'} · {deliveryLabels[notification.status]}</small></div><p>{notification.body}</p></article>) : <p>אין דיווחי שינוי חדשים.</p>}</div></section>
}
