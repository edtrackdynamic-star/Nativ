import { useState } from 'react'
import type { Course } from '../domain/catalog'
import type { WorkflowState } from '../domain/workflow'
import { changeStudentAssignment } from './firebaseApi'
import { useConfirmAction } from './interaction'
import { useReadOnly } from './readOnly'

export function ManualAssignmentChange({ cycleId, workflow, courses, clusterLabels, editable, onChanged, onShowDelivery }: { cycleId: string; workflow: WorkflowState; courses: Course[]; clusterLabels: Record<string, string>; editable: boolean; onChanged: () => Promise<void>; onShowDelivery: () => void }) {
  const { confirm, confirmation } = useConfirmAction()
  const readOnly = useReadOnly()
  const [studentId, setStudentId] = useState('')
  const [clusterId, setClusterId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const assignments = workflow.assignmentRun?.assignments ?? []
  const students = [...new Map(assignments.map((entry) => [entry.studentId, `${entry.studentLabel ?? 'תלמיד/ה'} · ${entry.studentClassLabel ?? ''}`])).entries()]
  const own = assignments.filter((entry) => entry.studentId === studentId)
  const current = own.find((entry) => entry.clusterId === clusterId)
  const options = courses.filter((entry) => entry.clusterId === clusterId && entry.published && entry.id !== current?.courseId)
  async function save() {
    if (pending || !studentId || !clusterId || !courseId || !reason.trim()) return
    const studentName = students.find(([id]) => id === studentId)?.[1] ?? 'התלמיד'
    const oldCourse = courses.find((entry) => entry.id === current?.courseId)?.label ?? 'הקורס הנוכחי'
    const newCourse = courses.find((entry) => entry.id === courseId)?.label ?? 'הקורס החדש'
    if (!await confirm(`לשנות את שיבוץ ${studentName} במקבץ ${clusterLabels[clusterId] ?? ''} מ${oldCourse} ל${newCourse}? השינוי יופיע מיד לתלמיד ולמזכירות.`)) return
    setPending(true)
    try {
      await changeStudentAssignment(cycleId, studentId, clusterId, courseId, reason.trim(), workflow.version)
      setMessage('השינוי נשמר והשיבוץ עודכן. עדכון המזכירות הועבר לשליחה; בדקו את מצבו ושלחו עדכונים לתלמיד ולמורים.')
      setStudentId(''); setClusterId(''); setCourseId(''); setReason('')
      try { await onChanged() } catch { setMessage('השינוי נשמר, אך רענון המסך נכשל. רעננו את המחזור ובדקו את השיבוץ לפני פעולה נוספת.') }
    } catch (error) {
      setMessage(error instanceof Error ? `השינוי לא הושלם: ${error.message} רעננו את המחזור, בדקו את השיבוץ ונסו שוב.` : 'השינוי לא הושלם. רעננו ובדקו את השיבוץ לפני ניסיון נוסף.')
    } finally { setPending(false) }
  }
  return <section className="workflow-section" aria-labelledby="manual-change-title">
    <h3 id="manual-change-title">שינוי שיבוץ תלמיד</h3>
    {confirmation}
    {!editable ? <p>המחזור סגור לשינויים. פנו למנהל המחזור אם נדרש תיקון.</p> : <>
      <div className="filter-bar">
        <label>תלמיד<select disabled={readOnly || pending} value={studentId} onChange={(event) => { setStudentId(event.target.value); setClusterId(''); setCourseId('') }}><option value="">בחירת תלמיד</option>{students.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>מקבץ<select disabled={readOnly || pending || !studentId} value={clusterId} onChange={(event) => { setClusterId(event.target.value); setCourseId('') }}><option value="">בחירת מקבץ</option>{own.map((entry) => <option key={entry.clusterId} value={entry.clusterId}>{clusterLabels[entry.clusterId] ?? 'מקבץ'} · {courses.find((course) => course.id === entry.courseId)?.label ?? 'קורס'}</option>)}</select></label>
        <label>קורס חדש<select disabled={readOnly || pending || !clusterId} value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">בחירת קורס</option>{options.map((course) => <option key={course.id} value={course.id}>{course.label}</option>)}</select></label>
      </div>
      <label>סיבה לשינוי<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={readOnly || pending} placeholder="סיבה תפעולית קצרה שתישמר ביומן, ולא תישלח במייל" /></label>
      <div className="workspace-actions"><button type="button" className="primary-action" disabled={readOnly || pending || !studentId || !clusterId || !courseId || !reason.trim()} onClick={() => void save()}>אישור וביצוע השינוי</button><button type="button" className="secondary-action" onClick={onShowDelivery}>שליחת עדכוני שינוי</button></div>
    </>}
    {message && <p role={message.startsWith('השינוי לא') ? 'alert' : 'status'}>{message}</p>}
  </section>
}
