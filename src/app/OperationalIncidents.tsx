import { useEffect, useState } from 'react'
import { listOperationalIncidents, type OperationalIncident } from './firebaseApi'

const actionLabels: Record<string, string> = { mail_delivery: 'שליחת הודעות', preview_assignment_change_delivery: 'הכנת עדכון שיבוץ', send_assignment_change_delivery: 'שליחת עדכון שיבוץ', execute_appeal_change: 'ביצוע שינוי לאחר ערעור', change_student_assignment: 'שינוי שיבוץ תלמיד' }

export function OperationalIncidents() {
  const [incidents, setIncidents] = useState<OperationalIncident[]>([])
  const [message, setMessage] = useState('')
  async function load() {
    try { setIncidents(await listOperationalIncidents()); setMessage('') }
    catch { setMessage('לא ניתן לטעון את יומן התקלות. רעננו את המסך או פנו למנהל־העל.') }
  }
  useEffect(() => {
    let active = true
    void listOperationalIncidents().then((items) => { if (active) { setIncidents(items); setMessage('') } }).catch(() => { if (active) setMessage('לא ניתן לטעון את יומן התקלות. רעננו את המסך או פנו למנהל־העל.') })
    return () => { active = false }
  }, [])
  return <section className="workflow-section" aria-labelledby="incident-title"><div className="workspace-heading"><div><h3 id="incident-title">תקלות מערכת הדורשות בדיקה</h3></div><button type="button" className="secondary-action" onClick={() => void load()}>רענון</button></div>{message && <p role="alert">{message}</p>}{incidents.length ? <ul>{incidents.map((incident) => <li key={incident.id}><strong>{actionLabels[incident.action] ?? 'פעולה בנתיב'}</strong> · {new Date(incident.occurredAt).toLocaleString('he-IL')} · מזהה {incident.id} · {incident.occurrences} מופעים{incident.status === 'no_recipient' ? ' · לא נמצא מנהל פעיל לעדכון' : ''}</li>)}</ul> : <p>אין תקלות מערכת מדווחות.</p>}</section>
}
