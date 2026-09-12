import { useState } from 'react'
import { downloadCycleDocument, extractCourseDescriptions, uploadCycleDocument, type ExtractedDescriptionResult } from './firebaseApi'
import { safeLink } from '../domain/formDesign'

interface Candidate { id:string; clusterLabel:string; label:string; instructorNames:string[]; description:string }
interface Review extends ExtractedDescriptionResult { selectedCourseId:string; replaceExisting:boolean }

export function CourseDescriptionImport({cycleId,documentUrl,documentStoragePath,documentName,candidates,onSourceChange,onApply,extractor=extractCourseDescriptions}: {
  cycleId:string; documentUrl:string; documentStoragePath:string; documentName:string; candidates:Candidate[]; onSourceChange:(source:{documentUrl:string;documentStoragePath:string;documentName:string})=>void; onApply:(values:Array<{courseId:string;description:string}>)=>void
  extractor?: typeof extractCourseDescriptions
}) {
  const [reviews,setReviews]=useState<Review[]>([])
  const [pending,setPending]=useState(false); const [message,setMessage]=useState('')
  let safeDocumentUrl=''
  try { safeDocumentUrl=safeLink(documentUrl,true) } catch { /* The save action reports invalid links. */ }
  async function upload(file:File) {
    if (file.size > 4 * 1024 * 1024) { setMessage('אפשר להוסיף קובץ Word עד 4MB.'); return }
    setPending(true)
    setMessage('שומר את המסמך…')
    try {
      const saved=await uploadCycleDocument(cycleId,file)
      onSourceChange({documentUrl:'',documentStoragePath:saved.path,documentName:saved.fileName})
      setReviews([])
      setMessage('המסמך נוסף. שמרו את הטופס כדי לפרסם את הקישור.')
    } catch(error) { setMessage(error instanceof Error?error.message:'שמירת המסמך נכשלה.') }
    finally { setPending(false) }
  }
  async function analyze() {
    if (pending) return
    try {
      if (!candidates.some(candidate=>candidate.label.trim())) throw new Error('יש להגדיר שמות קורסים לפני זיהוי התיאורים.')
      if (!documentStoragePath && !documentUrl.trim()) throw new Error('הדביקו קישור ל-Google Docs או בחרו קובץ Word.')
      setPending(true);setMessage('קורא את המסמך ומאתר תיאורי קורסים…');setReviews([])
      const source = documentStoragePath ? {kind:'stored_docx' as const,cycleId,path:documentStoragePath} : {kind:'google_docs' as const,url:documentUrl.trim()}
      const response=await extractor(source,candidates.map(({id,label,instructorNames})=>({id,label,instructorNames})))
      setReviews(response.results.map(result=>({...result,selectedCourseId:result.proposedCourseId,replaceExisting:false})))
      setMessage(response.results.length?`נמצאו ${response.results.length} תיאורים. בדקו וערכו לפני ההחלה.`:'לא נמצאו תיאורי קורסים במסמך.')
    } catch(error) {setMessage(error instanceof Error?error.message:'קריאת המסמך נכשלה.')} finally {setPending(false)}
  }
  function apply() {
    const selected=reviews.filter(review=>review.selectedCourseId && review.description.trim())
    const blocked=selected.find(review=>candidates.find(candidate=>candidate.id===review.selectedCourseId)?.description.trim() && !review.replaceExisting)
    if (blocked) {setMessage('יש תיאור קיים. סמנו החלפה או בחרו קורס אחר.');return}
    if (!selected.length) {setMessage('יש לבחור לפחות תיאור אחד להחלה.');return}
    onApply(selected.map(review=>({courseId:review.selectedCourseId,description:review.description.trim()})))
    setReviews([]);setMessage('התיאורים הוחלו על הטיוטה. יש לשמור את הטופס כדי לפרסם אותם.')
  }
  return <section className="document-import"><h3>מסמך תקצירי הקורסים</h3>
    <p>הוסיפו מסמך אחד למחזור. אותו מסמך ישמש לקריאת התקצירים ולהשלמת תיאורי הקורסים. בדקו כל תיאור לפני שתשמרו אותו.</p>
    <div className="setup-grid"><label>קישור ל-Google Docs<input type="url" value={documentUrl} onChange={e=>{onSourceChange({documentUrl:e.target.value,documentStoragePath:'',documentName:''});setReviews([])}} placeholder="https://docs.google.com/document/d/…" /></label><label>או קובץ Word<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={pending} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value=''}} /></label></div>
    {documentName && <p>המסמך שנבחר: {documentName}</p>}
    {safeDocumentUrl && <a href={safeDocumentUrl} target="_blank" rel="noopener noreferrer">פתיחת תקצירי הקורסים ↗</a>}
    {documentStoragePath && <button type="button" className="secondary-action" onClick={() => void downloadCycleDocument(cycleId,documentStoragePath).catch(() => setMessage('פתיחת המסמך נכשלה. נסו שוב.'))}>הורדת תקצירי הקורסים</button>}
    <p>למסמך Google פרטי, שתפו לצפייה עם <code>369491378125-compute@developer.gserviceaccount.com</code>.</p>
    {documentUrl && <p>ודאו שגם המורים והתלמידים יכולים לפתוח את המסמך ב־Google.</p>}
    <button type="button" disabled={pending || (!documentStoragePath && !documentUrl.trim())} onClick={()=>void analyze()}>{pending?'מזהה תיאורים…':'זיהוי תיאורים במסמך'}</button><p role="status">{message}</p>
    {reviews.length>0 && <><div className="description-review"><table><thead><tr><th>נמצא במסמך</th><th>שיוך לקורס</th><th>תיאור לעריכה</th></tr></thead><tbody>{reviews.map((review,index)=>{const target=candidates.find(candidate=>candidate.id===review.selectedCourseId);return <tr key={index}><td><strong>{review.sourceCourseName||'ללא שם'}</strong><small>{review.sourceTeacherName&&` · ${review.sourceTeacherName}`}</small><span>{review.match==='clear'?'התאמה מוצעת':'נדרשת בדיקה'}</span></td><td><select aria-label={`שיוך תיאור ${index+1}`} value={review.selectedCourseId} onChange={e=>setReviews(values=>values.map((value,i)=>i===index?{...value,selectedCourseId:e.target.value,replaceExisting:false}:value))}><option value="">ללא שיוך</option>{candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.clusterLabel} · {candidate.label}</option>)}</select>{target?.description.trim()&&<label><input type="checkbox" checked={review.replaceExisting} onChange={e=>setReviews(values=>values.map((value,i)=>i===index?{...value,replaceExisting:e.target.checked}:value))}/>החלפת התיאור הקיים</label>}</td><td><textarea rows={6} maxLength={4000} aria-label={`עריכת תיאור ${index+1}`} value={review.description} onChange={e=>setReviews(values=>values.map((value,i)=>i===index?{...value,description:e.target.value}:value))}/></td></tr>})}</tbody></table></div><button type="button" className="primary-action" onClick={apply}>החלת התיאורים שנבחרו</button></>}
  </section>
}
