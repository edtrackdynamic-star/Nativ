import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssignmentRun } from '../domain/workflow'
import type { Course, CycleCatalogSnapshot } from '../domain/catalog'
import type { StudentRosterEntry } from '../domain/studentRoster'
import { boardCellLabel, buildAssignmentBoard, type BoardStudent } from '../domain/assignmentBoard'
import { createAssignmentWorkbook } from '../domain/xlsxExport'
import { getStudentRoster, updateCourseMeetingPlace } from './firebaseApi'
import { useReadOnly } from './readOnly'

type View = 'course' | 'class' | 'student'
const collator = new Intl.Collator('he', { numeric: true })
const rankLabel = (rank: number | null) => rank === null ? 'ללא דירוג' : `דירוג ${rank}`

export function ResultExplorer({ cycleId, run, courses, catalog, placeEditable = true }: { cycleId: string; run: AssignmentRun; courses: Course[]; catalog: CycleCatalogSnapshot | null; placeEditable?: boolean }) {
  const readOnly = useReadOnly()
  const [open, setOpen] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<View>('course')
  const [query, setQuery] = useState('')
  const [clusterId, setClusterId] = useState('')
  const [rosterResult, setRosterResult] = useState<{ run: AssignmentRun; students: StudentRosterEntry[] } | null>(null)
  const [errorResult, setErrorResult] = useState<{ run: AssignmentRun; message: string } | null>(null)
  const [courseUpdates, setCourseUpdates] = useState<Record<string, Course>>({})
  const [editingCourseId, setEditingCourseId] = useState('')
  const [placeDraft, setPlaceDraft] = useState('')
  const [placeError, setPlaceError] = useState('')
  const [savingPlace, setSavingPlace] = useState(false)
  const displayCourses = useMemo(() => courses.map(course => courseUpdates[course.id] && courseUpdates[course.id].version >= course.version ? courseUpdates[course.id] : course), [courses, courseUpdates])
  const roster = rosterResult?.run === run ? rosterResult.students : null
  const loadError = errorResult?.run === run ? errorResult.message : ''
  const board = useMemo(() => roster ? buildAssignmentBoard(run, roster, displayCourses, catalog) : null, [run, roster, displayCourses, catalog])
  const search = query.trim().toLocaleLowerCase('he')
  const matches = (...values: string[]) => !search || values.some(value => value.toLocaleLowerCase('he').includes(search))
  const visibleClusters = board?.clusters.filter(cluster => !clusterId || cluster.id === clusterId) ?? []
  const visibleCourses = board?.courses.filter(course => (!clusterId || course.clusterId === clusterId) && (matches(course.label, course.clusterLabel, ...course.instructorNames, course.meetingPlace ?? '') || course.students.some(student => matches(student.name, student.classLabel)))) ?? []
  const visibleStudents = board?.students.filter(student => matches(student.name, student.classLabel, ...visibleClusters.map(cluster => boardCellLabel(student.cells[cluster.id])))) ?? []
  const classes = [...new Set(visibleStudents.map(student => student.classLabel))].sort(collator.compare)

  useEffect(() => {
    if (!open) return
    let active = true
    void getStudentRoster(cycleId).then(values => { if (active) { setRosterResult({ run, students: values }); setErrorResult(null) } }).catch(() => { if (active) setErrorResult({ run, message: 'רשימת התלמידים לא נטענה. אפשר לנסות שוב.' }) })
    return () => { active = false }
  }, [open, cycleId, run])
  useEffect(() => {
    if (!open) return
    const prior = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prior?.focus() }
  }, [open])

  function downloadWorkbook() {
    if (!board) return
    const content = createAssignmentWorkbook(board, run)
    const blob = new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `nativ-assignment-${run.id.slice(0, 8)}.xlsx`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function saveMeetingPlace(courseId: string) {
    const course = displayCourses.find(entry => entry.id === courseId)
    if (!course || savingPlace) return
    try {
      setSavingPlace(true)
      const updated = await updateCourseMeetingPlace(cycleId, courseId, placeDraft, course.version)
      setCourseUpdates(current => ({ ...current, [courseId]: updated }))
      setEditingCourseId('')
      setPlaceError('')
    } catch (error) {
      setPlaceError(error instanceof Error ? error.message : 'מקום המפגש לא נשמר. רעננו ונסו שוב.')
    } finally { setSavingPlace(false) }
  }
  const assignmentCell = (student: BoardStudent, id: string) => {
    const cell = student.cells[id]
    return <td key={id} data-status={cell.status}>{boardCellLabel(cell)}{cell.assignment && <small>{rankLabel(cell.assignment.rank)}</small>}</td>
  }
  return <section className="result-explorer" aria-labelledby="result-explorer-title">
    <div className="section-heading compact"><div><h4 id="result-explorer-title">תוצאות השיבוץ</h4><p>{run.publishedAt ? 'עיינו בשיבוץ שפורסם לפי קורס, כיתה או תלמיד.' : 'עיינו בשיבוץ לפי קורס, כיתה או תלמיד לפני האישור.'}</p></div><button type="button" className="primary-action" onClick={() => { setRosterResult(null); setErrorResult(null); setOpen(true) }}>הצגת השיבוץ</button></div>
    {open && <div className="result-overlay" role="dialog" aria-modal="true" aria-label="תוצאות השיבוץ" dir="rtl">
      <div className="result-dialog"><div className="result-dialog-head"><div><span className="eyebrow">{run.publishedAt ? 'שיבוץ שפורסם' : 'שיבוץ מוצע'}</span><h3>{run.label ?? 'תוצאות השיבוץ'}</h3><p>{new Date(run.executedAt).toLocaleString('he-IL')} · {run.assignments.length} שיבוצים</p></div><button ref={closeButton} type="button" className="secondary-action" onClick={() => setOpen(false)}>סגירה</button></div>
        <div className="result-controls"><div role="group" aria-label="הצגת תוצאות"><button type="button" aria-pressed={view === 'course'} onClick={() => setView('course')}>לפי קורס</button><button type="button" aria-pressed={view === 'class'} onClick={() => setView('class')}>לפי כיתה</button><button type="button" aria-pressed={view === 'student'} onClick={() => setView('student')}>לפי תלמיד</button></div><label>חיפוש<input value={query} onChange={event => setQuery(event.target.value)} placeholder="שם תלמיד, כיתה או קורס" /></label><label>מקבץ<select value={clusterId} onChange={event => setClusterId(event.target.value)}><option value="">כל המקבצים</option>{board?.clusters.map(cluster => <option key={cluster.id} value={cluster.id}>{cluster.label}</option>)}</select></label></div>
        {loadError && <p role="alert">{loadError} <button type="button" className="secondary-action" onClick={() => { setOpen(false); setRosterResult(null); setErrorResult(null); window.setTimeout(() => setOpen(true), 0) }}>טעינה מחדש</button></p>}
        {!board && !loadError && <p role="status">טוען את נתוני השיבוץ…</p>}
        {board && <><div className="result-downloads"><button type="button" className="secondary-action" onClick={downloadWorkbook}>הורדת Excel</button><span>{board.students.length} תלמידים · {board.assignmentCount} שיבוצים</span></div>
          <div className="result-groups">
            {board.issues.length > 0 && <details className="result-issues"><summary>{board.issues.length} נתונים דורשים בדיקה</summary><ul>{board.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
            {view === 'course' && (visibleCourses.length ? visibleCourses.map(course => <article className="result-course" key={course.id}><header><div><span className="eyebrow">{course.clusterLabel} · {course.weeklySlot}</span><h4>{course.label}</h4><p>{course.instructorNames.length ? `מנחה: ${course.instructorNames.join(', ')}` : 'מנחה לא הוגדר'} · {course.meetingPlace ? `מקום: ${course.meetingPlace}` : 'מקום מפגש לא הוגדר'}</p>{!readOnly && placeEditable && <button type="button" className="text-action" onClick={() => { setEditingCourseId(course.id); setPlaceDraft(course.meetingPlace ?? ''); setPlaceError('') }}>עריכת מקום מפגש</button>}</div><strong>{course.students.length} משובצים · יעד {course.target} · עד {course.maximum}</strong></header>{editingCourseId === course.id && placeEditable && <form className="result-place-editor" onSubmit={event => { event.preventDefault(); void saveMeetingPlace(course.id) }}><label>מקום מפגש<input maxLength={120} value={placeDraft} onChange={event => setPlaceDraft(event.target.value)} placeholder="לדוגמה: חדר אמנות" /></label><button type="submit" className="primary-action" disabled={savingPlace}>{savingPlace ? 'שומר…' : 'שמירה'}</button><button type="button" className="secondary-action" disabled={savingPlace} onClick={() => setEditingCourseId('')}>ביטול</button>{placeError && <p role="alert">מקום המפגש לא נשמר. {placeError}</p>}</form>}<div className="result-table-wrap"><table><thead><tr><th scope="col">תלמיד/ה</th><th scope="col">כיתה</th><th scope="col">דירוג</th></tr></thead><tbody>{course.students.map(student => { const assignment=student.cells[course.clusterId]?.assignment; return <tr key={student.id}><td>{student.name}</td><td>{student.classLabel}</td><td>{assignment ? rankLabel(assignment.rank) : '—'}</td></tr> })}</tbody></table></div>{!course.students.length && <p className="result-empty">אין תלמידים משובצים לקורס זה.</p>}</article>) : <p>אין קורסים שמתאימים לחיפוש.</p>)}
            {view === 'class' && (classes.length ? classes.map(classLabel => { const students=visibleStudents.filter(student=>student.classLabel===classLabel); return <section className="result-class" key={classLabel}><header><h4>{classLabel}</h4><span>{students.length} תלמידים</span></header><div className="result-table-wrap"><table><thead><tr><th scope="col">תלמיד/ה</th><th scope="col">טופס</th>{visibleClusters.map(cluster=><th scope="col" key={cluster.id}>{cluster.label}<small>{cluster.weeklySlot}</small></th>)}</tr></thead><tbody>{students.map(student=><tr key={student.id}><th scope="row">{student.name}</th><td>{student.hasForm ? 'הוגש' : 'לא הוגש'}</td>{visibleClusters.map(cluster=>assignmentCell(student,cluster.id))}</tr>)}</tbody></table></div></section> }) : <p>אין תלמידים שמתאימים לחיפוש.</p>)}
            {view === 'student' && (visibleStudents.length ? <div className="result-table-wrap"><table><thead><tr><th scope="col">כיתה</th><th scope="col">תלמיד/ה</th><th scope="col">טופס</th>{visibleClusters.map(cluster=><th scope="col" key={cluster.id}>{cluster.label}<small>{cluster.weeklySlot}</small></th>)}</tr></thead><tbody>{visibleStudents.map(student=><tr key={student.id}><td>{student.classLabel}</td><th scope="row">{student.name}</th><td>{student.hasForm ? 'הוגש' : 'לא הוגש'}</td>{visibleClusters.map(cluster=>assignmentCell(student,cluster.id))}</tr>)}</tbody></table></div> : <p>אין תלמידים שמתאימים לחיפוש.</p>)}
          </div></>}
      </div>
    </div>}
  </section>
}
