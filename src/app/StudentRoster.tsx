import { useEffect, useMemo, useState } from 'react'
import { filterStudents, type RosterFilters, type StudentRosterEntry } from '../domain/studentRoster'
import { getStudentRoster } from './firebaseApi'

export function StudentRoster({ cycleId, courseLabels, clusterLabels, revision }: { cycleId: string; courseLabels: Record<string, string>; clusterLabels: Record<string, string>; revision: number }) {
  const [students, setStudents] = useState<StudentRosterEntry[]>([])
  const [message, setMessage] = useState('טוען תלמידים…')
  const [reload, setReload] = useState(0)
  const [filters, setFilters] = useState<RosterFilters>({ query: '', classId: '', courseId: '', clusterId: '', status: '', mode: 'choices', rank: '' })
  const [limit, setLimit] = useState(50)
  useEffect(() => {
    let active = true
    void getStudentRoster(cycleId).then((rows) => { if (active) { setStudents(rows); setMessage('') } }).catch(() => { if (active) setMessage('לא ניתן לטעון את רשימת התלמידים. אפשר לנסות שוב.') })
    return () => { active = false }
  }, [cycleId, revision, reload])
  const shown = useMemo(() => filterStudents(students, filters), [students, filters])
  function update(patch: Partial<RosterFilters>) { setFilters({ ...filters, ...patch }); setLimit(50) }
  const classes = [...new Map(students.map((entry) => [entry.classId || 'unassigned', entry.classLabel])).entries()]
  const statuses = { not_submitted: 'טרם הגיש', submitted: 'הגיש', assigned: 'שובץ' }
  return <section className="workflow-section"><div className="workspace-heading"><div><h3>תלמידים ובחירות</h3><p>{students.length} תלמידים · {students.filter((entry) => entry.status === 'not_submitted').length} טרם הגישו</p></div><button className="text-action" onClick={() => setReload((value) => value + 1)}>רענון הרשימה</button></div>
    {message && <p role="status">{message}</p>}
    <div className="filter-bar">
      <label>חיפוש תלמיד<input value={filters.query} onChange={(event) => update({ query: event.target.value })} placeholder="שם התלמיד" /></label>
      <label>כיתת־אם<select value={filters.classId} onChange={(event) => update({ classId: event.target.value })}><option value="">כל הכיתות</option>{classes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>הצגה לפי<select value={filters.mode} onChange={(event) => update({ mode: event.target.value as RosterFilters['mode'], rank: '' })}><option value="choices">בחירות שהוגשו</option><option value="assignments">שיבוץ בפועל</option></select></label>
      <label>מקבץ<select value={filters.clusterId} onChange={(event) => update({ clusterId: event.target.value })}><option value="">כל המקבצים</option>{Object.entries(clusterLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>קורס<select value={filters.courseId} onChange={(event) => update({ courseId: event.target.value })}><option value="">כל הקורסים</option>{Object.entries(courseLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {filters.mode === 'choices' && <label>עדיפות<select value={filters.rank} onChange={(event) => update({ rank: event.target.value })}><option value="">כל העדיפויות</option>{[...new Set(students.flatMap((student) => student.choices.map((entry) => entry.rank)))].sort((a, b) => a - b).map((rank) => <option value={rank} key={rank}>{rank}</option>)}</select></label>}
      <label>מצב<select value={filters.status} onChange={(event) => update({ status: event.target.value })}><option value="">כל המצבים</option>{Object.entries(statuses).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    </div>
    <p aria-live="polite">{shown.length} תלמידים בתצוגה</p>
    <div className="table-scroll"><table className="roster-table"><thead><tr><th>תלמיד</th><th>כיתת־אם</th><th>מצב</th><th>{filters.mode === 'choices' ? 'קורסים שדורגו' : 'קורסים בשיבוץ'}</th></tr></thead><tbody>{shown.slice(0, limit).map((student) => <tr key={student.id}><th scope="row">{student.name}</th><td>{student.classLabel}</td><td>{statuses[student.status]}</td><td>{(filters.mode === 'choices' ? student.choices : student.assignments).map((entry) => <div key={`${entry.clusterId}-${entry.courseId}`}>{clusterLabels[entry.clusterId] ?? 'מקבץ'} · {courseLabels[entry.courseId] ?? 'קורס'}{'rank' in entry ? ` · עדיפות ${entry.rank}` : ''}</div>)}</td></tr>)}</tbody></table></div>
    {!shown.length && !message && <p>לא נמצאו תלמידים התואמים לסינון.</p>}
    {shown.length > limit && <button className="secondary-action" onClick={() => setLimit((value) => value + 50)}>הצגת תלמידים נוספים</button>}
  </section>
}
