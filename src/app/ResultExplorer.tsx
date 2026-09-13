import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssignmentRun } from '../domain/workflow'
import type { Course } from '../domain/catalog'
import { createAssignmentWorkbook } from '../domain/xlsxExport'

type View = 'course' | 'class' | 'student'
interface Row { student: string; schoolClass: string; cluster: string; course: string; rank: string; status: string }

export function ResultExplorer({ run, courses, clusterLabels }: { run: AssignmentRun; courses: Course[]; clusterLabels: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<View>('course')
  const [query, setQuery] = useState('')
  const [clusterId, setClusterId] = useState('')
  const rows = useMemo<Row[]>(() => run.assignments.map(entry => ({ student: entry.studentLabel ?? 'תלמיד/ה', schoolClass: entry.studentClassLabel ?? 'לא משויך', cluster: clusterLabels[entry.clusterId] ?? 'מקבץ', course: courses.find(course => course.id === entry.courseId)?.label ?? 'קורס', rank: entry.rank ? String(entry.rank) : 'ללא דירוג', status: 'שובץ' })), [run, courses, clusterLabels])
  const shown = rows.filter(row => (!clusterId || row.cluster === clusterLabels[clusterId]) && (!query.trim() || [row.student, row.schoolClass, row.cluster, row.course].some(value => value.includes(query.trim()))))
  const grouped = shown.reduce<Record<string, Row[]>>((result, row) => { const key = view === 'course' ? `${row.cluster} · ${row.course}` : view === 'class' ? row.schoolClass : row.student; (result[key] ??= []).push(row); return result }, {})
  const groups = Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right, 'he'))
  useEffect(() => {
    if (!open) return
    const prior = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prior?.focus() }
  }, [open])
  function downloadWorkbook() {
    const metadata = [[run.label ?? 'הרצת שיבוץ', run.publishedAt ? 'פורסם' : 'מוצע', new Date(run.executedAt).toLocaleString('he-IL')], []]
    const headers = ['כיתה', 'תלמיד/ה', 'מקבץ', 'קורס', 'דירוג', 'מצב']
    const ordered = (by: 'course' | 'class') => [...rows].sort((a, b) => (by === 'course' ? `${a.cluster} ${a.course} ${a.student}` : `${a.schoolClass} ${a.student} ${a.cluster}`).localeCompare(by === 'course' ? `${b.cluster} ${b.course} ${b.student}` : `${b.schoolClass} ${b.student} ${b.cluster}`, 'he')).map(row => [row.schoolClass, row.student, row.cluster, row.course, row.rank, row.status])
    const content = createAssignmentWorkbook([...metadata, headers, ...ordered('course')], [...metadata, headers, ...ordered('class')])
    const blob = new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `nativ-assignment-${run.id.slice(0, 8)}.xlsx`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="result-explorer" aria-labelledby="result-explorer-title">
    <div className="section-heading compact"><div><h4 id="result-explorer-title">תוצאות ההרצה</h4><p>בדקו את השיבוץ לפי קורס, כיתה או תלמיד לפני האישור.</p></div><button type="button" className="primary-action" onClick={() => setOpen(true)}>הצגת השיבוץ</button></div>
    {open && <div className="result-overlay" role="dialog" aria-modal="true" aria-label="תוצאות השיבוץ">
      <div className="result-dialog"><div className="result-dialog-head"><div><span className="eyebrow">{run.publishedAt ? 'שיבוץ שפורסם' : 'שיבוץ מוצע'}</span><h3>{run.label ?? 'תוצאות השיבוץ'}</h3><p>{new Date(run.executedAt).toLocaleString('he-IL')} · {rows.length} שיבוצים</p></div><button ref={closeButton} type="button" className="secondary-action" onClick={() => setOpen(false)}>סגירה</button></div>
        <div className="result-controls"><div role="group" aria-label="הצגת תוצאות"><button type="button" aria-pressed={view === 'course'} onClick={() => setView('course')}>לפי קורס</button><button type="button" aria-pressed={view === 'class'} onClick={() => setView('class')}>לפי כיתה</button><button type="button" aria-pressed={view === 'student'} onClick={() => setView('student')}>לפי תלמיד</button></div><label>חיפוש<input value={query} onChange={event => setQuery(event.target.value)} placeholder="שם תלמיד, כיתה או קורס" /></label><label>מקבץ<select value={clusterId} onChange={event => setClusterId(event.target.value)}><option value="">כל המקבצים</option>{Object.entries(clusterLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
        <div className="result-downloads"><button type="button" className="secondary-action" onClick={downloadWorkbook}>הורדת Excel לפי קורס ולפי כיתה</button></div>
        <div className="result-groups">{groups.length ? groups.map(([label, entries]) => <details key={label} open={groups.length <= 3}><summary>{label}<span>{entries?.length ?? 0} שיבוצים</span></summary><div className="table-scroll result-table"><table><thead><tr><th>תלמיד/ה</th><th>כיתה</th><th>מקבץ</th><th>קורס</th><th>דירוג</th></tr></thead><tbody>{entries?.map((row, index) => <tr key={`${label}-${index}`}><td>{row.student}</td><td>{row.schoolClass}</td><td>{row.cluster}</td><td>{row.course}</td><td>{row.rank}</td></tr>)}</tbody></table></div></details>) : <p>אין תוצאות שמתאימות לחיפוש.</p>}</div>
      </div>
    </div>}
  </section>
}
