import { useState } from 'react'
import { proposeCapacities } from '../domain/capacityPlanning'
import { useUnsavedChanges } from './interaction'

export function CapacityPlanner({students, courses, initialFlexibility, onApply}: {
  students: number | null
  courses: Array<{label:string; minimum:number|string; target:number|string; maximum:number|string; capacityLimit?:number}>
  initialFlexibility?:number
  onApply:(values:Array<{minimum:number;target:number;maximum:number;capacityLimit?:number}>,flexibility:number)=>void
}) {
  const [flexibility,setFlexibility]=useState(String(initialFlexibility??0))
  const [edits,setEdits]=useState<Record<number,{limit:string;minimum:string}>>({})
  const [message,setMessage]=useState('')
  useUnsavedChanges(Object.keys(edits).length>0 || flexibility!==String(initialFlexibility??0))
  const settings=courses.map((course,i)=>edits[i]??{limit:course.capacityLimit===undefined?'':String(course.capacityLimit),minimum:String(course.minimum)})
  let error=''; let proposal:ReturnType<typeof proposeCapacities>|undefined
  try {
    if (students===null) throw new Error('מספר התלמידים אינו זמין. טענו מחדש את התהליך כדי לחשב הצעה.')
    if (!flexibility.trim() || settings.some(s=>!s.minimum.trim())) throw new Error('יש למלא מספר בגמישות ובמינימום לפתיחה.')
    proposal=proposeCapacities(students,Number(flexibility),settings.map(s=>({minimum:Number(s.minimum),...(s.limit.trim()?{limit:Number(s.limit)}:{})})))
  } catch(e) {error=(e as Error).message}
  function apply() {
    if (!proposal || proposal.unplaced) return
    onApply(proposal.capacities.map((value,i)=>({...value,...(settings[i].limit.trim()?{capacityLimit:Number(settings[i].limit)}:{})})),Number(flexibility))
    setEdits({});setMessage('ההצעה הוחלה על טיוטת הקורסים. יש לשמור את הטופס.')
  }
  return <details className="capacity-planner"><summary>גודל קבוצות ומכסות</summary>
    <p>{students===null?'מספר התלמידים טרם נטען':`${students} תלמידים בכיתות המשתתפות · ${courses.length} קורסים`}</p>
    <label>גמישות מעבר ליעד בכל קורס<input type="number" min={0} value={flexibility} onChange={e=>{setFlexibility(e.target.value);setMessage('')}}/></label>
    <p>היעדים מתחלקים במספרים שלמים. מכסה מגבילה את הקורס גם כשמותרת גמישות; השאירו מכסה ריקה כשאין מגבלה מיוחדת. מינימום 0 פירושו שאין סף פתיחה.</p>
    <div className="editable-course-table"><table><thead><tr><th>קורס</th><th>מכסה מיוחדת</th><th>מינימום לפתיחה</th><th>יעד מוצע</th><th>מרבי מוצע</th><th>יעד / מרבי בטיוטה</th></tr></thead><tbody>{courses.map((course,i)=><tr key={i}><th>{course.label||`קורס ${i+1}`}</th><td><input type="number" min={1} placeholder="ללא מכסה" aria-label={`מכסה לקורס ${i+1}`} value={settings[i].limit} onChange={e=>{setEdits({...edits,[i]:{...settings[i],limit:e.target.value}});setMessage('')}}/></td><td><input type="number" min={0} aria-label={`מינימום לקורס ${i+1}`} value={settings[i].minimum} onChange={e=>{setEdits({...edits,[i]:{...settings[i],minimum:e.target.value}});setMessage('')}}/></td><td>{proposal?.capacities[i].target??'—'}</td><td>{proposal?.capacities[i].maximum??'—'}</td><td>{course.target} / {course.maximum}</td></tr>)}</tbody></table></div>
    {error && <p role="alert">{error}</p>}{proposal && <p role="status">{proposal.unplaced?`חסרים מקומות ל-${proposal.unplaced} תלמידים. הגדילו מכסות או הוסיפו קורס.`:`יש מקום לכל ${students} התלמידים; ${proposal.totalSeats} מקומות בסך הכול.`}</p>}
    <button type="button" disabled={!proposal || !!proposal.unplaced} onClick={apply}>החלת ההצעה על הקורסים</button><p role="status">{message}</p>
  </details>
}
