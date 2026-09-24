import { useState } from 'react'
import type { CycleCatalogSnapshot } from '../domain/catalog'
import { commitGoogleFormsImport, previewGoogleFormsImport, type GoogleFormsMapping, type GoogleFormsPreview } from './firebaseApi'
import { useReadOnly } from './readOnly'

function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה. נסו להוריד אותו שוב מגוגל'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}

export function GoogleFormsImport({ cycleId, catalog, onImported }: { cycleId: string; catalog: CycleCatalogSnapshot | null; onImported: () => Promise<void> }) {
  const readOnly = useReadOnly()
  const [file, setFile] = useState<File | null>(null)
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState<GoogleFormsPreview | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<GoogleFormsMapping | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  async function choose(next: File | null) {
    setFile(next); setPreview(null); setMapping(null); setHeaders([]); setContent(''); setMessage('')
    if (!next) return
    if (!/\.(xlsx|csv)$/iu.test(next.name) || next.size > 6 * 1024 * 1024) { setMessage('יש לבחור קובץ Excel או CSV עד 6MB'); return }
    try { setContent(await encodeFile(next)) } catch (error) { setMessage(error instanceof Error ? error.message : 'קריאת הקובץ נכשלה') }
  }
  async function check() {
    if (!file || !content || pending) return
    setPending(true); setMessage('בודק את התשובות…')
    try {
      const result = await previewGoogleFormsImport(cycleId, file.name, content, mapping ?? undefined)
      setPreview(result); setMapping(result.mapping); setHeaders(result.headers); setMessage(result.blocked ? 'יש לתקן את השורות והעמודות המסומנות לפני קליטה.' : 'הבדיקה הסתיימה. בדקו את הסיכום ואשרו קליטה.')
    } catch (error) { setPreview(null); setMessage(error instanceof Error ? error.message : 'בדיקת הקובץ נכשלה. נסו שוב.') }
    finally { setPending(false) }
  }
  function change(update: GoogleFormsMapping) { setMapping(update); setPreview(null); setMessage('בדקו שוב את הקובץ לאחר שינוי ההתאמות.') }
  async function commit() {
    if (!file || !content || !mapping || !preview || preview.blocked || !preview.ready || pending || readOnly) return
    if (!window.confirm(`לקלוט בחירות של ${preview.ready} תלמידים? ההגשות יופיעו בלוח הבחירות.`)) return
    setPending(true); setMessage('קולט את הבחירות…')
    try {
      const result = await commitGoogleFormsImport(cycleId, file.name, content, mapping)
      setMessage(`נקלטו ${result.created} בחירות. ${result.unchanged} כבר היו מעודכנות. ${result.superseded} תשובות ישנות הוחלפו בתשובה מאוחרת.`)
      setPreview(null)
      try { await onImported() } catch { setMessage(`הקליטה נשמרה: ${result.created} בחירות חדשות. רענון הרשימה נכשל; רעננו את העמוד לפני ניסיון נוסף.`) }
    } catch (error) { setMessage(`הקליטה לא הושלמה. ${error instanceof Error ? error.message : 'רעננו את המסך ובדקו את המצב לפני ניסיון נוסף.'}`) }
    finally { setPending(false) }
  }
  const columns = headers
  const columnOptions = <><option value="-1">בחרו עמודה</option>{columns.map((header, index) => <option key={index} value={index}>{header || `עמודה ${index + 1}`}</option>)}</>
  return <details className="workflow-section"><summary>קליטת בחירות מטופס גוגל</summary>
    <p>הורידו את גיליון התגובות כקובץ Excel או CSV. הבחירות ייקלטו רק לאחר בדיקה ואישור.</p>
    <label>קובץ תגובות<input type="file" accept=".xlsx,.csv" disabled={readOnly || pending} onChange={(event) => void choose(event.target.files?.[0] ?? null)} /></label>
    {file && content && <button type="button" className="secondary-action" disabled={pending} onClick={() => void check()}>{pending ? 'בודק…' : 'בדיקת הקובץ'}</button>}
    {message && <p role="status">{message}</p>}
    {mapping && <>
      {preview && <p>{preview.total} תשובות בקובץ · {preview.ready} מוכנות לקליטה · {preview.blocked} דורשות טיפול · {preview.replaced} תשובות קודמות של אותו תלמיד</p>}
      <div className="filter-bar">
        <label>שם התלמיד<select value={mapping.name} onChange={(event) => change({ ...mapping, name: Number(event.target.value) })}>{columnOptions}</select></label>
        <label>כיתה<select value={mapping.className} onChange={(event) => change({ ...mapping, className: Number(event.target.value) })}>{columnOptions}</select></label>
        {catalog?.clusters.flatMap((cluster) => [
          ...cluster.courses.map((course) => <label key={course.courseId}>{course.label}<select value={mapping.courses[course.courseId] ?? -1} onChange={(event) => change({ ...mapping, courses: { ...mapping.courses, [course.courseId]: Number(event.target.value) } })}>{columnOptions}</select></label>),
          <label key={`${cluster.clusterId}-rationale`}>נימוק · {cluster.label}<select value={mapping.rationales[cluster.clusterId] ?? -1} onChange={(event) => change({ ...mapping, rationales: { ...mapping.rationales, [cluster.clusterId]: Number(event.target.value) } })}>{columnOptions}</select></label>,
        ])}
      </div>
      {preview && <div className="table-scroll"><table className="roster-table"><thead><tr><th>שורה</th><th>שם</th><th>כיתה</th><th>בדיקה</th><th>שיוך תלמיד</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row}><td>{row.row}</td><th scope="row">{row.name}</th><td>{row.className}</td><td>{row.duplicateOf ? `תשובה קודמת; שורה ${row.duplicateOf} תיקלט` : row.errors.length ? row.errors.join(' · ') : 'מוכנה'}</td><td>{!row.duplicateOf && <select aria-label={`שיוך תלמיד בשורה ${row.row}`} value={mapping.students[String(row.row)] ?? row.studentId} onChange={(event) => change({ ...mapping, students: { ...mapping.students, [String(row.row)]: event.target.value } })}><option value="">בחרו תלמיד</option>{preview.students.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.className}</option>)}</select>}</td></tr>)}</tbody></table></div>}
      {preview && <button type="button" className="primary-action" disabled={readOnly || pending || preview.blocked > 0 || preview.ready === 0} onClick={() => void commit()}>אישור וקליטת הבחירות</button>}
    </>}
    {mapping && !preview && content && <button type="button" className="secondary-action" disabled={pending} onClick={() => void check()}>בדיקה חוזרת</button>}
  </details>
}
