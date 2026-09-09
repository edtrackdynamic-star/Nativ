import { useUnsavedChanges } from './interaction'
import { useState } from 'react'
import { capacityError, parseTable } from '../domain/tablePaste'
import { safeLink } from '../domain/formDesign'
import type { CatalogClusterDraft, CatalogCourseDraft } from './firebaseApi'
import { InstructorPicker, type Instructor } from './InstructorPicker'

const fields = { cluster: 'מקבץ', label: 'שם הקורס', teachers: 'מורים', minimum: 'מינימום', target: 'יעד', maximum: 'מקסימום', documentUrl: 'קישור למסמך', description: 'תיאור', subjectArea: 'תחום דעת' }
type Field = keyof typeof fields
type ImportRow = { cluster: string; course: CatalogCourseDraft; teacherText: string; unresolved: boolean }
export function CourseTableImport({ instructors, onAdd, availableClusters }: { instructors: Instructor[]; availableClusters: number; onAdd: (clusters: CatalogClusterDraft[]) => void }) {
  const [text, setText] = useState(''); const [header, setHeader] = useState(true)
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
    if (mapping.label === undefined || mapping.cluster === undefined || mapping.teachers === undefined) throw new Error('יש להתאים עמודות למקבץ, לשם הקורס ולמורים.')
    const chosen = Object.values(mapping).filter(v => v !== undefined)
    if (new Set(chosen).size !== chosen.length) throw new Error('יש לבחור עמודה שונה לכל שדה.')
    const data = header ? table.slice(1) : table
    if (!data.length) throw new Error('אין שורות קורסים אחרי הכותרת.')
    const next = data.map((line, index): ImportRow => {
      const get = (field: Field, fallback = '') => mapping[field] === undefined ? fallback : line[mapping[field]!] ?? ''
      const cluster = get('cluster'); const label = get('label')
      if (!cluster || !label) throw new Error(`בשורת קורס ${index + 1} חסר שם מקבץ או קורס.`)
      const minimum = get('minimum', '0'), target = get('target', '18'), maximum = get('maximum', '22')
      const error = capacityError(minimum, target, maximum)
      if (error) throw new Error(`בשורת קורס ${index + 1}: ${error}`)
      const teacherText = get('teachers'); const names = teacherText.split(/[,;\n]+/).map(v => v.trim()).filter(Boolean)
      let unresolved = !names.length
      const ids = names.flatMap(name => {
        const found = instructors.filter(t => t.displayName.trim().replace(/\s+/g, ' ') === name.replace(/\s+/g, ' '))
        if (found.length !== 1) { unresolved = true; return [] }
        return [found[0].uid]
      })
      return { cluster, teacherText, unresolved, course: { label, description: get('description'), subjectArea: get('subjectArea'), documentUrl: safeLink(get('documentUrl'), true), instructorIds: [...new Set(ids)], minimum: Number(minimum), target: Number(target), maximum: Number(maximum), repeatPolicy: 'allowed' } }
    })
    if (next.some((r, i) => next.slice(0, i).some(other => other.cluster === r.cluster && other.course.label === r.course.label))) throw new Error('יש שם קורס שחוזר באותו מקבץ בטבלה. תקנו את הכפילות לפני ההוספה.')
    setRows(next); setMessage('')
  } catch (error) { setMessage((error as Error).message); setRows([]) } }
  function add() {
    if (!rows.length || rows.some(r => r.unresolved || !r.course.instructorIds.length)) return
    const groups: CatalogClusterDraft[] = []
    for (const row of rows) {
      let group = groups.find(c => c.label === row.cluster)
      if (!group) { group = { label: row.cluster, requiredRankingCount: 1, balanceByClass: false, courses: [] }; groups.push(group) }
      group.courses.push(row.course)
    }
    if (groups.length > 20 || groups.some(group => group.courses.length > 40)) { setMessage('אפשר להוסיף עד 20 מקבצים ועד 40 קורסים בכל מקבץ. חלקו את הטבלה בהתאם.'); return }
    if (groups.length > availableClusters) { setMessage(`נותר מקום ל-${availableClusters} מקבצים בתהליך. הסירו מקבצים ריקים או צמצמו את הטבלה.`); return }
    onAdd(groups); setRows([]); setTable([]); setText(''); setMessage(`נוספו ${groups.length} מקבצים לטופס. יש לשמור את הטופס להשלמת הפעולה.`)
  }
  return <details className="table-import"><summary>הוספת קורסים מטבלה</summary>
    <p>העתיקו תאים מאקסל או Google Sheets והדביקו כאן. הקורסים יתווספו במקבצים חדשים. לאחר ההוספה תוכלו לבחור את הכיתות המשתתפות ואת מספר הקורסים לדירוג.</p>
    <label>הטבלה להוספה<textarea rows={5} value={text} onChange={e => { setText(e.target.value); setTable([]); setRows([]); setMessage('') }} /></label>
    <label className="setup-option"><input type="checkbox" checked={header} onChange={e => { setHeader(e.target.checked); setTable([]); setRows([]) }} />השורה הראשונה מכילה כותרות</label>
    <button type="button" onClick={read}>התאמת עמודות</button>
    {table.length > 0 && <><div className="setup-grid">{(Object.keys(fields) as Field[]).map(field => <label key={field}>{fields[field]}<select value={mapping[field] ?? ''} onChange={e => { setMapping({ ...mapping, [field]: e.target.value === '' ? undefined : Number(e.target.value) }); setRows([]) }}><option value="">ללא עמודה</option>{Array.from({ length: Math.max(...table.map(r => r.length)) }, (_, i) => <option key={i} value={i}>עמודה {i + 1}: {(table[0][i] ?? '').slice(0, 60)}</option>)}</select></label>)}</div><p>בלי עמודות קיבולת: מינימום 0, יעד 18 ומקסימום 22. הפרידו כמה שמות מורים בפסיק או בנקודה ופסיק.</p><button type="button" onClick={preview}>בדיקה ותצוגה מקדימה</button></>}
    <p role="status">{message}</p>
    {rows.length > 0 && <><h3>בדיקת {rows.length} קורסים לפני הוספה</h3>{rows.map((row, i) => <section className="setup-course" key={i}><h4>{row.cluster} — {row.course.label}</h4><p>מינימום {row.course.minimum} · יעד {row.course.target} · מקסימום {row.course.maximum}</p>{row.course.description && <p>{row.course.description}</p>}{row.course.documentUrl && <a href={row.course.documentUrl} target="_blank" rel="noreferrer">מסמך הקורס</a>}<p>מורים בטבלה: {row.teacherText || 'לא צוינו'}</p><InstructorPicker instructors={instructors} selected={row.course.instructorIds} onChange={ids => setRows(values => values.map((v, j) => j === i ? { ...v, course: { ...v.course, instructorIds: ids } } : v))} />{row.unresolved && <><p role="alert">יש שם מורה שלא זוהה או מתאים לכמה מורים. בחרו את המורים הנכונים ואשרו את הבחירה.</p><button type="button" disabled={!row.course.instructorIds.length} onClick={() => setRows(values => values.map((v, j) => j === i ? { ...v, unresolved: false } : v))}>אישור המורים לקורס</button></>}</section>)}<button type="button" className="primary-action" disabled={rows.some(r => r.unresolved || !r.course.instructorIds.length)} onClick={add}>הוספת המקבצים והקורסים לטופס</button></>}
  </details>
}
