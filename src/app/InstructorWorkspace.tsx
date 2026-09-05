import { useEffect, useState } from 'react'
import { getInstructorWorkspace, type InstructorWorkspaceData } from './firebaseApi'

export function InstructorWorkspace({ cycleId }: { cycleId: string }) {
  const [data, setData] = useState<InstructorWorkspaceData | null>(null)
  const [message, setMessage] = useState('טוען את הקורסים שלך…')
  async function refresh() { const loaded = await getInstructorWorkspace(cycleId); setData(loaded); setMessage('הנתונים מעודכנים.') }
  useEffect(() => { let active = true; void getInstructorWorkspace(cycleId).then((loaded) => { if (active) { setData(loaded); setMessage('הנתונים מעודכנים.') } }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'טעינת הקורסים נכשלה') }); return () => { active = false } }, [cycleId])
  return <section className="workspace-card" aria-labelledby="instructor-title"><div className="workspace-heading"><div><span className="eyebrow">אזור מנחה</span><h2 id="instructor-title">הקורסים שלי</h2></div></div><p className="workspace-message" aria-live="polite">{message}</p>{data && !data.courses.length && <p>לא נמצאו קורסים המשויכים אליך במחזור זה.</p>}{data?.courses.map((course) => <article className="workflow-item" key={course.id}><div><strong>{course.label}</strong>{course.subjectArea && <small>{course.subjectArea}</small>}</div>{course.description && <p>{course.description}</p>}<h3>תלמידים בקורס</h3>{course.students.length ? <ul>{course.students.map((student, index) => <li key={`${student}-${index}`}>{student}</li>)}</ul> : <p>רשימת התלמידים תהיה זמינה לאחר פרסום השיבוץ.</p>}</article>)}<button type="button" className="secondary-action" onClick={() => void refresh()}>רענון</button></section>
}
