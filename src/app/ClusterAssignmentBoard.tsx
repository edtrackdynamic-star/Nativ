import { useEffect, useRef, useState } from 'react'
import type { AssignmentRun, WorkflowState } from '../domain/workflow'
import type { AssignmentResult } from '../domain/assignmentEngine'
import type { AssignmentBoard, BoardStudent } from '../domain/assignmentBoard'
import { buildAssignmentBoard } from '../domain/assignmentBoard'
import type { Course, CycleCatalogSnapshot } from '../domain/catalog'
import type { StudentChoiceDetails, StudentRosterEntry } from '../domain/studentRoster'
import { changeStudentAssignment, getStudentChoiceDetails, saveManualProposedAssignment, selectAssignmentRun } from './firebaseApi'
import { useUnsavedChanges } from './interaction'

type SavedMove = { kind: 'proposed' | 'published'; studentId: string; beforeCourseId: string; afterCourseId: string; previousRunId: string; resultingRunId: string; workflowVersion: number }
type StagedMove = { studentId: string; beforeCourseId: string; afterCourseId: string }

function previewRun(run: AssignmentRun, student: BoardStudent, clusterId: string, courseId: string, roster: StudentRosterEntry[]): AssignmentRun {
  const previous = run.assignments.find(entry => entry.studentId === student.id && entry.clusterId === clusterId)
  const rank = roster.find(entry => entry.id === student.id)?.choices.find(choice => choice.clusterId === clusterId && choice.courseId === courseId)?.rank ?? null
  const replacement: AssignmentResult = { studentId: student.id, studentLabel: student.name, studentClassLabel: student.classLabel, clusterId, courseId, rank, source: 'manual', aiPriority: 'neutral', explanation: 'שינוי שיבוץ מוצע' }
  const assignments = previous ? run.assignments.map(entry => entry === previous ? replacement : entry) : [...run.assignments, replacement]
  const enrollmentByCourse = { ...run.enrollmentByCourse, [courseId]: (run.enrollmentByCourse[courseId] ?? 0) + 1 }
  if (previous) enrollmentByCourse[previous.courseId] = Math.max(0, (enrollmentByCourse[previous.courseId] ?? 0) - 1)
  return { ...run, assignments, enrollmentByCourse }
}

const rankText = (rank: number | null) => rank === null ? 'לא דורג' : `בחירה ${rank}`
const rankTone = (rank: number | null) => rank === 1 ? 'first' : rank === 2 ? 'second' : rank !== null && rank >= 3 ? 'later' : 'unranked'

export function ClusterAssignmentBoard({ cycleId, run, workflow, board, roster, courses, catalog, clusterId, editable, onWorkflow, onPublishedChanged, onShowDelivery, onDraftChange, onBusyChange }: {
  cycleId: string; run: AssignmentRun; workflow?: WorkflowState; board: AssignmentBoard; roster: StudentRosterEntry[]; courses: Course[]; catalog: CycleCatalogSnapshot | null; clusterId: string; editable: boolean
  onWorkflow?: (next: WorkflowState) => void; onPublishedChanged?: () => Promise<void>; onShowDelivery?: () => void; onDraftChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void
}) {
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [staged, setStaged] = useState<StagedMove | null>(null)
  const [savedMove, setSavedMove] = useState<SavedMove | null>(null)
  const [undoConfirm, setUndoConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [detailStudent, setDetailStudent] = useState<BoardStudent | null>(null)
  const [detailResult, setDetailResult] = useState<{ studentId: string; details: StudentChoiceDetails | null } | null>(null)
  const [detailError, setDetailError] = useState('')
  const [fullForm, setFullForm] = useState(false)
  const detailBox = useRef<HTMLElement>(null)
  const detailOpener = useRef<HTMLElement | null>(null)
  useUnsavedChanges(Boolean(staged) || pending)
  useEffect(() => { onDraftChange?.(Boolean(staged) || pending) }, [staged, pending, onDraftChange])
  useEffect(() => () => { onDraftChange?.(false) }, [onDraftChange])
  useEffect(() => { onBusyChange?.(pending) }, [pending, onBusyChange])
  useEffect(() => () => { onBusyChange?.(false) }, [onBusyChange])
  const cluster = board.clusters.find(entry => entry.id === clusterId)
  const actualStudents = board.students.filter(student => student.cells[clusterId]?.status !== 'not_applicable')
  const selected = actualStudents.find(student => student.id === selectedStudentId)
  const stagedStudent = actualStudents.find(student => student.id === staged?.studentId)
  const projectedRun = staged && stagedStudent ? previewRun(run, stagedStudent, clusterId, staged.afterCourseId, roster) : run
  const projectedBoard = projectedRun === run ? board : buildAssignmentBoard(projectedRun, roster, courses, catalog)
  const clusterCourses = projectedBoard.courses.filter(course => course.clusterId === clusterId)
  const actualCourses = board.courses.filter(course => course.clusterId === clusterId)
  const unplaced = projectedBoard.students.filter(student => ['unassigned', 'no_form', 'excluded'].includes(student.cells[clusterId]?.status ?? '') && student.cells[clusterId]?.status !== 'not_applicable')
  const search = query.trim().toLocaleLowerCase('he')
  const visible = (student: BoardStudent) => !search || `${student.name} ${student.classLabel}`.toLocaleLowerCase('he').includes(search)
  const target = courses.find(course => course.id === staged?.afterCourseId)
  const before = courses.find(course => course.id === staged?.beforeCourseId)
  const afterCount = actualCourses.find(course => course.id === staged?.afterCourseId)?.students.length ?? 0
  const beforeCount = actualCourses.find(course => course.id === staged?.beforeCourseId)?.students.length ?? 0
  const selectedRank = roster.find(entry => entry.id === staged?.studentId)?.choices.find(choice => choice.clusterId === clusterId && choice.courseId === staged?.afterCourseId)?.rank ?? null
  const canUndoSaved = Boolean(savedMove && workflow?.version === savedMove.workflowVersion && (savedMove.kind === 'proposed' ? run.id === savedMove.resultingRunId : run.assignments.some(entry => entry.studentId === savedMove.studentId && entry.clusterId === clusterId && entry.courseId === savedMove.afterCourseId)))

  function openDetails(student: BoardStudent) { detailOpener.current = document.activeElement as HTMLElement | null; setDetailResult(null); setDetailError(''); setFullForm(false); setDetailStudent(student) }
  function closeDetails() { setDetailStudent(null); window.setTimeout(() => detailOpener.current?.focus(), 0) }
  function selectStudent(student: BoardStudent) { if (staged && staged.studentId !== student.id) { setMessage('אשרו או בטלו את ההעברה המוצעת לפני בחירת תלמיד/ה אחר/ת.'); return } setSelectedStudentId(student.id); setMessage('') }
  useEffect(() => {
    if (!detailStudent) return
    let active = true
    void getStudentChoiceDetails(cycleId, detailStudent.id).then(details => { if (active) setDetailResult({ studentId: detailStudent.id, details }) }).catch(() => { if (active) setDetailError('לא ניתן לטעון את הבחירות. נסו לפתוח אותן שוב.') })
    return () => { active = false }
  }, [cycleId, detailStudent])

  function stage(courseId: string) {
    setMessage('')
    if (!selected || !editable || !workflow || pending) return
    const current = selected.cells[clusterId]
    const next = courses.find(course => course.id === courseId && course.clusterId === clusterId && course.published)
    if (!next) return
    if (current.course?.id === courseId) { setStaged(null); return }
    if (!['assigned', 'unassigned'].includes(current.status) || (current.status === 'unassigned' && (!selected.hasForm || run.publishedAt))) { setMessage('אפשר להעביר רק תלמיד/ה המשתתף/ת במקבץ. לאחר פרסום נדרש שיבוץ קיים.'); return }
    if (workflow.appeals.some(appeal => appeal.studentId === selected.id && appeal.clusterId === clusterId && !['executed', 'rejected'].includes(appeal.status))) { setMessage('לתלמיד/ה יש ערעור פתוח במקבץ זה. יש לטפל בו תחילה.'); return }
    const count = actualCourses.find(course => course.id === courseId)?.students.length ?? 0
    if (count >= next.capacity.maximum) { setMessage(`בקורס ${next.label} אין מקום פנוי.`); return }
    if (next.repeatPolicy === 'prohibited' && run.assignments.some(entry => entry.studentId === selected.id && entry.clusterId !== clusterId && courses.find(course => course.id === entry.courseId)?.logicalCourseId === next.logicalCourseId)) { setMessage('מדיניות הקורס אינה מאפשרת לתלמיד/ה להשתתף בו שוב.'); return }
    setStaged({ studentId: selected.id, beforeCourseId: current.course?.id ?? '', afterCourseId: courseId })
    setReason('')
  }

  async function save() {
    if (!staged || !workflow || !reason.trim() || pending || !editable) return
    setPending(true); setMessage('')
    let saved = false
    try {
      if (run.publishedAt) {
        const result = await changeStudentAssignment(cycleId, staged.studentId, clusterId, staged.afterCourseId, reason.trim(), workflow.version)
        saved = true
        setSavedMove({ kind: 'published', studentId: staged.studentId, beforeCourseId: staged.beforeCourseId, afterCourseId: staged.afterCourseId, previousRunId: run.id, resultingRunId: run.id, workflowVersion: result.workflow.version })
        await onPublishedChanged?.()
        setMessage('השיבוץ עודכן. העדכון למזכירות הועבר לשליחה; אפשר לבדוק ולשלוח עדכונים נוספים.')
      } else {
        const next = await saveManualProposedAssignment(cycleId, staged.studentId, clusterId, staged.afterCourseId, reason.trim(), workflow.version)
        saved = true
        onWorkflow?.(next)
        setSavedMove({ kind: 'proposed', studentId: staged.studentId, beforeCourseId: staged.beforeCourseId, afterCourseId: staged.afterCourseId, previousRunId: run.id, resultingRunId: next.assignmentRun?.id ?? '', workflowVersion: next.version })
        setMessage('נשמרה גרסת הצעה חדשה. השינוי עדיין לא פורסם לתלמידים.')
      }
    } catch (error) { setMessage(saved ? 'השינוי נשמר, אך רענון הלוח נכשל. רעננו ובדקו את השיבוץ לפני פעולה נוספת.' : error instanceof Error ? `השינוי לא נשמר: ${error.message}` : 'השינוי לא נשמר. רעננו את הנתונים ונסו שוב.') }
    finally { if (saved) { setStaged(null); setReason(''); setSelectedStudentId('') } setPending(false) }
  }

  async function undo() {
    if (!savedMove || !workflow || !canUndoSaved || pending) return
    setPending(true); setMessage('')
    let restored = false
    try {
      if (savedMove.kind === 'proposed') {
        const next = await selectAssignmentRun(cycleId, savedMove.previousRunId, workflow.version)
        restored = true
        onWorkflow?.(next)
        setMessage('השינוי בוטל וגרסת ההצעה הקודמת הוחזרה.')
      } else {
        await changeStudentAssignment(cycleId, savedMove.studentId, clusterId, savedMove.beforeCourseId, 'ביטול שינוי שיבוץ ידני קודם', workflow.version)
        restored = true
        await onPublishedChanged?.()
        setMessage('השיבוץ הקודם הוחזר. גם פעולה זו תועדה ונשלח עדכון למזכירות.')
      }
    } catch (error) { setMessage(restored ? 'הביטול בוצע, אך רענון הלוח נכשל. רעננו ובדקו את השיבוץ.' : error instanceof Error ? `הביטול לא הושלם: ${error.message}` : 'הביטול לא הושלם. רעננו את הנתונים לפני ניסיון נוסף.') }
    finally { if (restored) { setSavedMove(null); setUndoConfirm(false) } setPending(false) }
  }

  if (!cluster) return <p>לא נמצאו קורסים במקבץ זה.</p>
  const choiceDetails = detailResult && detailResult.studentId === detailStudent?.id ? detailResult.details : null
  const selectedPreference = choiceDetails?.preferences.find(preference => preference.clusterId === clusterId)
  const selectedSnapshot = choiceDetails?.catalogSnapshot.find(snapshot => snapshot.clusterId === clusterId)
  return <section className="cluster-board" aria-label={`שיבוץ במקבץ ${cluster.label}`}>
    <div className="cluster-board-toolbar"><div><h4>{cluster.label}</h4><p>{cluster.weeklySlot} · {actualCourses.reduce((sum, course) => sum + course.students.length, 0)} משובצים</p></div><label>חיפוש תלמיד/ה<input value={query} onChange={event => setQuery(event.target.value)} placeholder="שם או כיתה" /></label></div>
    <p className="cluster-board-help">{editable ? 'בחרו תלמיד/ה ואז לחצו על כותרת הקורס שאליו רוצים להעביר. לחיצה כפולה או כפתור „בחירות” מציגים את הדירוג והנימוק.' : 'לחיצה כפולה או כפתור „בחירות” מציגים את הדירוג והנימוק.'}</p>
    <div className="cluster-board-legend" aria-label="מקרא דירוגים"><span data-rank="first">בחירה 1</span><span data-rank="second">בחירה 2</span><span data-rank="later">בחירה 3 ומטה</span><span data-rank="unranked">לא דורג</span></div>
    {message && <p role={message.startsWith('השינוי לא') || message.startsWith('הביטול לא') ? 'alert' : 'status'}>{message}</p>}
    <div className="cluster-board-scroll"><div className="cluster-board-columns">
      {clusterCourses.map(course => <section key={course.id} className="cluster-board-column" aria-label={`${course.label}, ${course.students.length} משובצים`}><header><button type="button" className="cluster-board-target" disabled={!selected || !editable || pending} onClick={() => stage(course.id)} aria-label={`הצעת העברה של ${selected?.name ?? 'תלמיד/ה'} אל ${course.label}`}><strong>{course.label}</strong><span>{course.students.length} / {course.maximum} משובצים</span></button><small>{course.instructorNames.join(', ') || 'מנחה לא הוגדר'}{course.meetingPlace ? ` · ${course.meetingPlace}` : ''}</small></header><div className="cluster-board-students">{course.students.filter(visible).map(student => { const assignment = student.cells[clusterId]?.assignment; return <div className={`cluster-board-student ${selectedStudentId === student.id ? 'selected' : ''} ${staged?.studentId === student.id ? 'staged' : ''}`} data-rank={rankTone(assignment?.rank ?? null)} key={student.id}><button type="button" className="cluster-board-student-select" aria-pressed={selectedStudentId === student.id} onClick={() => selectStudent(student)} onDoubleClick={() => openDetails(student)}><strong>{student.name}</strong><small>{student.classLabel} · {rankText(assignment?.rank ?? null)}</small></button><button type="button" className="cluster-board-info" onClick={() => openDetails(student)} aria-label={`הבחירות של ${student.name}`}>בחירות</button></div> })}{!course.students.length && <p className="cluster-board-empty">אין תלמידים משובצים.</p>}</div></section>)}
      <section className="cluster-board-column cluster-board-unplaced"><header><strong>ללא שיבוץ במקבץ</strong><span>{unplaced.length} תלמידים</span></header><div className="cluster-board-students">{unplaced.filter(visible).map(student => <div className={`cluster-board-student ${selectedStudentId === student.id ? 'selected' : ''}`} key={student.id}><button type="button" className="cluster-board-student-select" aria-pressed={selectedStudentId === student.id} onClick={() => selectStudent(student)} onDoubleClick={() => openDetails(student)}><strong>{student.name}</strong><small>{student.classLabel} · {{ no_form: 'לא הוגש טופס', unassigned: 'לא שובץ', excluded: 'לא נכלל בהרצה', assigned: '', not_applicable: '' }[student.cells[clusterId]?.status ?? 'not_applicable']}</small></button><button type="button" className="cluster-board-info" onClick={() => openDetails(student)} aria-label={`הבחירות של ${student.name}`}>בחירות</button></div>)}{!unplaced.length && <p className="cluster-board-empty">כל המשתתפים שובצו.</p>}</div></section>
    </div></div>
    {staged && stagedStudent && target && <div className="cluster-board-review" role="status"><div><strong>העברה מוצעת: {stagedStudent.name}</strong><p>{before?.label ?? 'ללא שיבוץ'} ← {target.label} · {rankText(selectedRank)}</p><p>{before?.label ?? 'ללא שיבוץ'}: {beforeCount} ← {Math.max(0, beforeCount - (before ? 1 : 0))} · {target.label}: {afterCount} ← {afterCount + 1} מתוך {target.capacity.maximum}</p><small>נמצא מקום פנוי. אם יימצא אילוץ נוסף, השינוי לא יישמר. {run.publishedAt ? 'לאחר אישור השינוי יוצג לתלמיד/ה ויתועד עדכון למזכירות.' : 'השינוי יישמר בגרסת הצעה חדשה ויידרש אישור לפני פרסום.'}</small></div><label>סיבה לשינוי<textarea rows={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="סיבה קצרה שתישמר בתיעוד" /></label><div className="cluster-board-actions"><button type="button" className="primary-action" disabled={pending || !reason.trim()} onClick={() => void save()}>{pending ? 'שומר…' : 'אישור העברה'}</button><button type="button" className="secondary-action" disabled={pending} onClick={() => { setStaged(null); setReason('') }}>ביטול ההצעה</button></div></div>}
    {canUndoSaved && !staged && <div className="cluster-board-undo"><span>השינוי האחרון נשמר.</span>{undoConfirm ? <><span>{savedMove?.kind === 'published' ? 'החזרת השיבוץ הקודם תתועד ותשלח עדכון נוסף למזכירות.' : 'לחזור לגרסת ההצעה הקודמת?'}</span><button type="button" className="primary-action" disabled={pending} onClick={() => void undo()}>אישור הביטול</button><button type="button" className="secondary-action" disabled={pending} onClick={() => setUndoConfirm(false)}>השארת השינוי</button></> : <button type="button" className="secondary-action" onClick={() => setUndoConfirm(true)}>ביטול השינוי האחרון</button>}</div>}
    {run.publishedAt && onShowDelivery && <button type="button" className="text-action" onClick={onShowDelivery}>בדיקת עדכוני שינוי ושליחתם</button>}
    {detailStudent && <div className="cluster-board-detail-backdrop" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeDetails() } if (event.key === 'Tab') { const focusable = [...(detailBox.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? [])]; if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } } }}><section ref={detailBox} className="cluster-board-detail" role="dialog" aria-modal="true" aria-label={`הבחירות של ${detailStudent.name}`}><header><div><h4>{detailStudent.name}</h4><p>{detailStudent.classLabel} · {cluster.label}</p></div><button type="button" className="secondary-action" autoFocus onClick={closeDetails}>סגירה</button></header>{detailError && <p role="alert">{detailError}</p>}{!detailResult && !detailError && <p role="status">טוען את הבחירות…</p>}{detailResult && !choiceDetails && <p>לא הוגש טופס בחירה.</p>}{choiceDetails && <><h5>הדירוג במקבץ</h5>{selectedPreference?.rankings.length ? <ol>{[...selectedPreference.rankings].sort((a, b) => a.rank - b.rank).map(ranking => <li key={ranking.courseId}>{selectedSnapshot?.courses.find(course => course.courseId === ranking.courseId)?.label ?? 'קורס'} · בחירה {ranking.rank}</li>)}</ol> : <p>לא נמצאו דירוגים במקבץ.</p>}<p><strong>נימוק:</strong> {selectedPreference?.rationale?.trim() || 'לא נכתב נימוק.'}</p><button type="button" className="secondary-action" aria-expanded={fullForm} onClick={() => setFullForm(value => !value)}>{fullForm ? 'הסתרת הטופס המקורי' : 'הטופס המקורי המלא'}</button>{fullForm && <div className="cluster-board-full-form">{choiceDetails.preferences.map(preference => { const snapshot = choiceDetails.catalogSnapshot.find(entry => entry.clusterId === preference.clusterId); return <section key={preference.clusterId}><h5>{snapshot?.label ?? 'מקבץ'}</h5><ol>{[...preference.rankings].sort((a, b) => a.rank - b.rank).map(ranking => <li key={ranking.courseId}>{snapshot?.courses.find(course => course.courseId === ranking.courseId)?.label ?? 'קורס'} · בחירה {ranking.rank}</li>)}</ol><p><strong>נימוק:</strong> {preference.rationale?.trim() || 'לא נכתב נימוק.'}</p></section> })}<small>גרסת טופס {choiceDetails.submissionVersion}{choiceDetails.submittedAt && ` · הוגש ${new Date(choiceDetails.submittedAt).toLocaleString('he-IL')}`}</small></div>}</>}</section></div>}
  </section>
}
