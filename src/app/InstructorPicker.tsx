import { useState } from 'react'

export type Instructor = { uid: string; displayName: string }
export function InstructorPicker({ instructors, selected, onChange }: { instructors: Instructor[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const matches = instructors.filter(t => !selected.includes(t.uid) && query.trim().split(/\s+/).every(part => t.displayName.toLocaleLowerCase().includes(part.toLocaleLowerCase())))
  return <fieldset className="instructor-search"><legend>מורים מנחים</legend>
    <div className="workspace-actions">{selected.map(id => <button type="button" key={id} onClick={() => onChange(selected.filter(value => value !== id))} aria-label={`הסרת ${instructors.find(t => t.uid === id)?.displayName ?? 'מורה'}`}>{instructors.find(t => t.uid === id)?.displayName ?? 'מורה שאינו פעיל'} ×</button>)}</div>
    <label>חיפוש מורה<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="הקלידו שם מורה" /></label>
    {!instructors.length && <p>לא נמצאו מורים פעילים בבית הספר.</p>}
    {query.trim() && <div className="instructor-results">{matches.map(t => <button type="button" key={t.uid} onClick={() => { onChange([...selected, t.uid]); setQuery('') }}>{t.displayName}{instructors.filter(other => other.displayName === t.displayName).length > 1 ? ` (${t.uid})` : ''}</button>)}{!matches.length && <p role="status">לא נמצאו מורים נוספים בשם זה.</p>}</div>}
  </fieldset>
}
