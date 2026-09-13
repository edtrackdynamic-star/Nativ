import { useState } from 'react'
import type { AssignmentCycle } from '../domain/cycle'
import { setAppealDeadline } from './firebaseApi'
import { formatIsraelDateTime, fromIsraelDateTimeInput, toIsraelDateTimeInput } from './israelDateTime'

export function AppealDeadlineControl({ cycle, readOnly, onSaved }: { cycle: AssignmentCycle; readOnly: boolean; onSaved: (cycle: AssignmentCycle) => void }) {
  const [value, setValue] = useState(() => toIsraelDateTimeInput(cycle.appealDeadlineEnabled ? cycle.appealClosesAt : undefined))
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const saved = toIsraelDateTimeInput(cycle.appealDeadlineEnabled ? cycle.appealClosesAt : undefined)
  async function save() {
    if (pending || value === saved) return
    try {
      setPending(true)
      const iso = value ? fromIsraelDateTimeInput(value) : null
      const next = await setAppealDeadline(cycle.id, cycle.version, iso)
      onSaved(next)
      setMessage(iso ? `מועד הגשת הערעורים נשמר: ${formatIsraelDateTime(iso)}.` : 'הגבלת מועד הגשת הערעורים הוסרה.')
    } catch (error) { setMessage(`המועד לא נשמר. ${error instanceof Error ? error.message : 'רעננו את המחזור ונסו שוב.'}`) }
    finally { setPending(false) }
  }
  return <section className="appeal-deadline-control" aria-labelledby="appeal-deadline-title"><h4 id="appeal-deadline-title">מועד הגשת ערעורים</h4><p>אפשר להאריך את המועד גם לאחר שחלף. ערעורים שכבר הוגשו נשמרים.</p><div className="workspace-actions"><label>מועד אחרון, שעון ישראל<input type="datetime-local" value={value} disabled={readOnly || pending} onChange={event => setValue(event.target.value)} /></label><button type="button" className="secondary-action" disabled={readOnly || pending || value === saved} onClick={() => void save()}>{pending ? 'שומר…' : 'שמירת המועד'}</button></div>{cycle.appealDeadlineEnabled && cycle.appealClosesAt && <p>המועד הנוכחי: {formatIsraelDateTime(cycle.appealClosesAt)}</p>}{message && <p role={message.startsWith('המועד לא') ? 'alert' : 'status'}>{message}</p>}</section>
}
