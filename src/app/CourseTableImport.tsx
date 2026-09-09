import { useUnsavedChanges } from './interaction'
import { useState } from 'react'
import { parseTable } from '../domain/tablePaste'
import type { CatalogCourseDraft } from './firebaseApi'
import { InstructorPicker, type Instructor } from './InstructorPicker'

const fields = { label: 'שם הקורס', teachers: 'מורים', subjectArea: 'תחום דעת' }
type Field = keyof typeof fields
type ImportRow = { course: CatalogCourseDraft; teacherText: string; unresolved: boolean }
export function CourseTableImport({ instructors, onAdd, clusterName, existingCourses }: { instructors: Instructor[]; clusterName: string; existingCourses: Array<{label:string}>; onAdd: (courses: CatalogCourseDraft[]) => void }) {
  const [text, setText] = useState(''); const [header, setHeader] = useState(false)
  const [table, setTable] = useState<string[][]>([]); const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({})
  const [rows, setRows] = useState<ImportRow[]>([]); const [message, setMessage] = useState('')
  useUnsavedChanges(Boolean(text))
  function read() { try {
    const next = parseTable(text); setTable(next); setRows([]); setMessage('')
    const guessed: Partial<Record<Field, number>> = {}
    if (header) for (const field of Object.keys(fields) as Field[]) {
      const index = next[0].findIndex(value => value === fields[field] || (field === 'label' && value === 'קורס') || (field === 'teachers' && ['מורה', 'מורים מנחים'].includes(value)))
      if (index >= 0) guessed[field] = index
    }
    setMapping(guessed)
  } catch (error) { setMessage((error as Error).message); setRows([]); setTable([]) } }
  function preview() { try {
    if (mapping.label === undefined || mapping.teachers === undefined) throw new Error('יש להתאים עמודות לשם הקורס ולמורים.')
    const chosen = Object.values(mapping).filter(v => v !== undefined)
    if (new Set(chosen).size !== chosen.length) throw new Error('יש לבחור עמודה שונה לכל שדה.')
    const data = header ? table.slice(1) : table
    if (!data.length) throw new Error('אין שורות קורסים אחרי הכותרת.')
    const next = data.map((line, index): ImportRow => {
      const get = (field: Field, fallback = '') => mapping[field] === undefined ? fallback : line[mapping[field]!] ?? ''
      const label = get('label')
      if (!label) throw new Error(`בשורת קורס ${index + 1} חסר שם קורס.`)
      const teacherText = get('teachers'); const names = teacherText.split(/[,;\n]+/).map(v => v.trim()).filter(Boolean)
      let unresolved = !names.length
      const ids = names.flatMap(name => {
        const found = instructors.filter(t => t.displayName.trim().replace(/\s+/g, ' ') === name.replace(/\s+/g, ' '))
        if (found.length !== 1) { unresolved = true; return [] }
        return [found[0].uid]
      })
      return { teacherText, unresolved, course: { label, description: '', subjectArea: get('subjectArea'), instructorIds: [...new Set(ids)], minimum: 0, target: 18, maximum: 22, repeatPolicy: 'allowed' } }
    })
    if (next.some((r, i) => next.slice(0, i).some(other => other.course.label === r.course.label))) throw new Error('יש שם קורס שחוזר באותו מקבץ בטבלה. תקנו את הכפילות לפני ההוספה.')
    setRows(next); setMessage('')
  } catch (error) { setMessage((error as Error).message); setRows([]) } }
  function add() {
    if (!rows.length || rows.some(r => r.unresolved || !r.course.instructorIds.length)) return
    if (rows.some(r=>!r.course.label.trim())) { setMessage('יש למלא שם קורס בכל שורה.'); return }
    if (new Set(rows.map(r=>r.course.label.trim())).size !== rows.length) { setMessage('שם קורס חוזר בטבלה. תקנו את הכפילות.'); return }
    if (existingCourses.length + rows.length > 40) { setMessage('אפשר להגדיר עד 40 קורסים במקבץ, כולל הקורסים הקיימים.'); return }
    if (rows.some(row => existingCourses.some(course => course.label.trim() === row.course.label.trim()))) { setMessage('קורס בשם זה כבר קיים במקבץ. בדקו את הטבלה לפני ההוספה.'); return }
    onAdd(rows.map(row=>row.course)); setRows([]); setTable([]); setText(''); setMessage('הקורסים נוספו למקבץ. יש לשמור את הטופס להשלמת הפעולה.')
  }
  return <details className="table-import"><summary>הוספת קורסים מטבלה</summary>
    <p>הדביקו טבלה מאקסל, Google Sheets או מהצ׳אט. בדקו את העמודות ואת התצוגה המקדימה, ואז לחצו על הוספה למקבץ.</p>
    <p>מקבץ: {clusterName || 'המקבץ הנוכחי'}</p>
    <label>הטבלה להוספה<textarea rows={5} value={text} onChange={e => { setText(e.target.value); setTable([]); setRows([]); setMessage('') }} /></label>
    <label className="setup-option"><input type="checkbox" checked={header} onChange={e => { setHeader(e.target.checked); setTable([]); setRows([]) }} />השורה הראשונה מכילה כותרות</label>
    <button type="button" onClick={read}>התאמת עמודות</button>
    {table.length > 0 && <><div className="paste-table-preview"><table><caption>כך חולקה הטבלה — {header ? table.length-1 : table.length} שורות קורסים</caption><thead><tr>{table[0].map((_,i)=><th key={i}>עמודה {i+1}</th>)}</tr></thead><tbody>{(header ? table.slice(1) : table).slice(0,6).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div><div className="setup-grid">{(Object.keys(fields) as Field[]).map(field => <label key={field}>{fields[field]}<select value={mapping[field] ?? ''} onChange={e => { setMapping({ ...mapping, [field]: e.target.value === '' ? undefined : Number(e.target.value) }); setRows([]) }}><option value="">ללא עמודה</option>{Array.from({ length: Math.max(...table.map(r => r.length)) }, (_, i) => <option key={i} value={i}>עמודה {i + 1}: {(table[0][i] ?? '').slice(0, 60)}</option>)}</select></label>)}</div><p>הפרידו כמה שמות מורים בפסיק או בנקודה ופסיק.</p><button type="button" onClick={preview}>בדיקה ותצוגה מקדימה</button></>}
    <p role="status">{message}</p>
    {rows.length > 0 && <><h3>בדיקת {rows.length} קורסים לפני הוספה</h3><div className="editable-course-table"><table><thead><tr><th>שם הקורס</th><th>מורים</th><th>תחום דעת</th><th>פעולות</th></tr></thead><tbody>{rows.map((row,i)=><tr key={i}>
      <td><input aria-label={'שם הקורס בשורה '+(i+1)} value={row.course.label} onChange={e=>setRows(values=>values.map((v,j)=>j===i?{...v,course:{...v.course,label:e.target.value}}:v))}/></td>
      <td>{row.teacherText && <small>בטבלה: {row.teacherText}</small>}<InstructorPicker instructors={instructors} selected={row.course.instructorIds} onChange={ids=>setRows(values=>values.map((v,j)=>j===i?{...v,course:{...v.course,instructorIds:ids}}:v))}/>{row.unresolved && <><p>יש לבחור ולאשר את המורים לשורה זו.</p><button type="button" disabled={!row.course.instructorIds.length} onClick={()=>setRows(values=>values.map((v,j)=>j===i?{...v,unresolved:false}:v))}>אישור המורים לקורס</button></>}</td>
      <td><input aria-label={'תחום דעת בשורה '+(i+1)} value={row.course.subjectArea} onChange={e=>setRows(values=>values.map((v,j)=>j===i?{...v,course:{...v.course,subjectArea:e.target.value}}:v))}/></td>
      <td><button type="button" aria-label={'מחיקת שורה '+(i+1)} onClick={()=>setRows(values=>values.filter((_,j)=>j!==i))}>מחיקה</button></td>
    </tr>)}</tbody></table></div><button type="button" onClick={()=>setRows(values=>[...values,{teacherText:'',unresolved:false,course:{label:'',description:'',subjectArea:'',instructorIds:[],minimum:0,target:18,maximum:22,repeatPolicy:'allowed'}}])}>הוספת שורה</button><p>בדקו וערכו את התאים לפני ההוספה. גודל הקבוצות נקבע בנפרד במקבץ.</p><button type="button" className="primary-action" disabled={rows.some(r=>r.unresolved || !r.course.instructorIds.length || !r.course.label.trim())} onClick={add}>הוספה למקבץ</button></>}
  </details>
}
