import { useEffect, useMemo, useState } from 'react'
import type { Course } from '../domain/catalog'
import type { WorkflowState } from '../domain/workflow'
import type { StudentRosterEntry } from '../domain/studentRoster'
import { getStudentRoster, saveManualProposedAssignment } from './firebaseApi'
import { useConfirmAction } from './interaction'

export function ManualProposedAssignment({ cycleId, workflow, courses, clusterLabels, readOnly, onWorkflow }: {
  cycleId: string; workflow: WorkflowState; courses: Course[]; clusterLabels: Record<string, string>; readOnly: boolean; onWorkflow: (next: WorkflowState) => void
}) {
  const { confirm, confirmation } = useConfirmAction()
  const [students, setStudents] = useState<StudentRosterEntry[]>([])
  const [query, setQuery] = useState('')
  const [studentId, setStudentId] = useState('')
  const [clusterId, setClusterId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => { let active = true; void getStudentRoster(cycleId).then(entries => { if (active) setStudents(entries.filter(entry => entry.choices.length)) }).catch(() => { if (active) setMessage('טעינת התלמידים נכשלה. רעננו את המסך ונסו שוב.') }); return () => { active = false } }, [cycleId])
  const run = workflow.assignmentRun
  const student = students.find(entry => entry.id === studentId)
  const current = run?.assignments.find(entry => entry.studentId === studentId && entry.clusterId === clusterId)
  const visibleStudents = useMemo(() => students.filter(entry => !query.trim() || `${entry.name} ${entry.classLabel}`.includes(query.trim())).slice(0, 30), [students, query])
  const eligibleClusters = student?.choices.filter((entry, index, all) => all.findIndex(other => other.clusterId === entry.clusterId) === index).filter(entry => !run?.scope?.excludedClassIdsByCluster[entry.clusterId]?.includes(student.classId) && !run?.scope?.excludedStudentIdsByCluster[entry.clusterId]?.includes(student.id)) ?? []
  const options = courses.filter(entry => entry.clusterId === clusterId && entry.published).map(entry => ({ ...entry, taken: run?.enrollmentByCourse[entry.id] ?? 0 })).filter(entry => entry.id !== current?.courseId && entry.taken < entry.capacity.maximum)
  const selectedCourse = options.find(entry => entry.id === courseId)
  const selectedRank = student?.choices.find(entry => entry.clusterId === clusterId && entry.courseId === courseId)?.rank

  async function save() {
    if (!run || !student || !clusterId || !selectedCourse || !reason.trim() || pending) return
    const before = courses.find(entry => entry.id === current?.courseId)?.label ?? 'ללא שיבוץ'
    if (!await confirm(`לשמור גרסת שיבוץ מוצע חדשה עבור ${student.name}? במקבץ ${clusterLabels[clusterId] ?? 'הנבחר'} השיבוץ ישתנה מ־${before} ל־${selectedCourse.label}. הגרסה החדשה תדרוש אישור לפני פרסום.`)) return
    setPending(true)
    try {
      const next = await saveManualProposedAssignment(cycleId, student.id, clusterId, selectedCourse.id, reason.trim(), workflow.version)
      onWorkflow(next)
      setCourseId(''); setReason('')
      setMessage('השינוי נשמר בגרסת שיבוץ מוצע חדשה. בדקו את התוצאות לפני אישור ופרסום.')
    } catch (error) { setMessage(`השיבוץ הידני לא נשמר. ${error instanceof Error ? error.message : 'רעננו את ההרצה ונסו שוב.'}`) }
    finally { setPending(false) }
  }

  return <section className="manual-proposal" aria-labelledby="manual-proposal-title">
    <div className="section-heading compact"><div><h4 id="manual-proposal-title">שיבוץ ידני בהצעה</h4><p>בחרו תלמיד, מקבץ וקורס עם מקום פנוי. כל שינוי יישמר כגרסת הצעה חדשה; התלמידים יראו אותו רק לאחר פרסום.</p></div></div>
    {confirmation}
    <div className="manual-proposal-grid">
      <label>חיפוש תלמיד<input value={query} onChange={event => { setQuery(event.target.value); setStudentId(''); setClusterId(''); setCourseId('') }} placeholder="שם או כיתה" /></label>
      <label>תלמיד<select value={studentId} disabled={readOnly || pending} onChange={event => { setStudentId(event.target.value); setClusterId(''); setCourseId('') }}><option value="">בחרו תלמיד</option>{visibleStudents.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {entry.classLabel}</option>)}</select></label>
      <label>מקבץ<select value={clusterId} disabled={readOnly || pending || !studentId} onChange={event => { setClusterId(event.target.value); setCourseId('') }}><option value="">בחרו מקבץ</option>{eligibleClusters.map(entry => <option key={entry.clusterId} value={entry.clusterId}>{clusterLabels[entry.clusterId] ?? 'מקבץ'}</option>)}</select></label>
      <label>קורס עם מקום פנוי<select value={courseId} disabled={readOnly || pending || !clusterId} onChange={event => setCourseId(event.target.value)}><option value="">בחרו קורס</option>{options.map(entry => <option key={entry.id} value={entry.id}>{entry.label} · {entry.capacity.maximum - entry.taken} מקומות פנויים</option>)}</select></label>
    </div>
    {student && !eligibleClusters.length && <p role="status">לתלמיד/ה אין מקבץ פעיל בהרצה הזו. בדקו את הכיתה וההחרגות באזור שינוי המשתתפים.</p>}
    {clusterId && <p role="status">שיבוץ נוכחי: {courses.find(entry => entry.id === current?.courseId)?.label ?? 'טרם שובץ'}{selectedCourse && ` · הקורס המבוקש: ${selectedCourse.label}${selectedRank ? ` (עדיפות ${selectedRank})` : ' (לא דורג)'}`}</p>}
    {clusterId && !options.length && <p role="status">אין כרגע קורס אחר עם מקום פנוי במקבץ. אפשר לשנות מכסה בהגדרות וליצור הרצה חדשה.</p>}
    <label>סיבה לשינוי<textarea maxLength={500} rows={2} value={reason} disabled={readOnly || pending} onChange={event => setReason(event.target.value)} placeholder="סיבה קצרה לצוות; לא תוצג לתלמידים" /></label>
    <button type="button" className="primary-action" disabled={readOnly || pending || !studentId || !clusterId || !courseId || !reason.trim()} onClick={() => void save()}>{pending ? 'שומר…' : 'שמירת השיבוץ בהצעה'}</button>
    {message && <p role={message.startsWith('השיבוץ הידני לא') ? 'alert' : 'status'}>{message}</p>}
  </section>
}
