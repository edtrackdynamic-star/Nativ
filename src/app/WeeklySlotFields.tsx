import type { WeeklySlot } from '../domain/weeklySlot'
import { weekdayNames, weeklySlotLabel } from '../domain/weeklySlot'
import { useState } from 'react'

export function WeeklySlotFields({ value, onChange, disabled = false }: { value?: WeeklySlot; onChange: (value?: WeeklySlot) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<{ field: 'start' | 'end'; text: string } | null>(null)
  function changePeriod(field: 'start' | 'end', text: string) {
    setDraft({ field, text })
    const parsed = Number(text)
    if (!value || !text || !Number.isInteger(parsed) || parsed < 1 || parsed > 20) return
    if (field === 'start') onChange({ ...value, periodStart: parsed, periodEnd: Math.max(parsed, value.periodEnd) })
    else onChange({ ...value, periodEnd: parsed, periodStart: Math.min(parsed, value.periodStart) })
    setDraft(null)
  }
  return <fieldset className="weekly-slot-fields" disabled={disabled}><legend>מועד המפגש השבועי</legend>
    <label>יום בשבוע<select value={value?.weekday ?? ''} onChange={event => onChange(event.target.value === '' ? undefined : { weekday: Number(event.target.value), periodStart: value?.periodStart ?? 1, periodEnd: value?.periodEnd ?? 1, timeStart: value?.timeStart, timeEnd: value?.timeEnd })}><option value="">טרם הוגדר</option>{weekdayNames.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
    {value && <><label>משעה<input type="number" min="1" max="20" value={draft?.field === 'start' ? draft.text : value.periodStart} onChange={event => changePeriod('start', event.target.value)} onBlur={() => setDraft(null)} /></label><label>עד שעה<input type="number" min="1" max="20" value={draft?.field === 'end' ? draft.text : value.periodEnd} onChange={event => changePeriod('end', event.target.value)} onBlur={() => setDraft(null)} /></label><label>תחילה בשעון, רשות<input type="time" value={value.timeStart ?? ''} onChange={event => onChange({ ...value, timeStart: event.target.value || undefined, timeEnd: event.target.value ? value.timeEnd : undefined })} /></label><label>סיום בשעון, רשות<input type="time" value={value.timeEnd ?? ''} onChange={event => onChange({ ...value, timeEnd: event.target.value || undefined })} /></label></>}
    <p>{weeklySlotLabel(value)}</p>
  </fieldset>
}
