import { useState } from 'react'
import { extractCourseDescriptions, type ExtractedDescriptionResult } from './firebaseApi'

interface Candidate { id:string; clusterLabel:string; label:string; instructorNames:string[]; description:string }
interface Review extends ExtractedDescriptionResult { selectedCourseId:string; replaceExisting:boolean }

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes); let result = ''
  for (let offset=0; offset<view.length; offset+=0x8000) result += String.fromCharCode(...view.subarray(offset,offset+0x8000))
  return btoa(result)
}

export function CourseDescriptionImport({documentUrl,candidates,onDocumentUrl,onApply,extractor=extractCourseDescriptions}: {
  documentUrl:string; candidates:Candidate[]; onDocumentUrl:(url:string)=>void; onApply:(values:Array<{courseId:string;description:string}>)=>void
  extractor?: typeof extractCourseDescriptions
}) {
  const [file,setFile]=useState<File|null>(null); const [reviews,setReviews]=useState<Review[]>([])
  const [pending,setPending]=useState(false); const [message,setMessage]=useState('')
  async function analyze() {
    if (pending) return
    try {
      if (!candidates.some(candidate=>candidate.label.trim())) throw new Error('יש להגדיר שמות קורסים לפני זיהוי התיאורים.')
      if (!file && !documentUrl.trim()) throw new Error('הדביקו קישור ל-Google Docs או בחרו קובץ Word.')
      if (file && file.size>4*1024*1024) throw new Error('ניתן לקרוא קובץ Word עד 4MB.')
      setPending(true);setMessage('קורא את המסמך ומאתר תיאורי קורסים…');setReviews([])
      const source = file ? {kind:'docx' as const,fileName:file.name,base64:toBase64(await file.arrayBuffer())} : {kind:'google_docs' as const,url:documentUrl.trim()}
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
  return <details className="document-import"><summary>השלמת תיאורי קורסים ממסמך</summary>
    <p>אפשר לצרף מקור בתחילת העבודה או להמשיך בלעדיו. תוכן המסמך נשלח ל-Gemini רק בלחיצה על זיהוי, וההצעות אינן משנות את הטופס עד לאישורכם.</p>
    <div className="setup-grid"><label>קישור ל-Google Docs<input type="url" value={documentUrl} onChange={e=>{onDocumentUrl(e.target.value);setFile(null);setReviews([])}} placeholder="https://docs.google.com/document/d/…" /></label><label>או קובץ Word<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e=>{setFile(e.target.files?.[0]??null);setReviews([])}} /></label></div>
    <p>למסמך Google פרטי, שתפו לצפייה עם <code>369491378125-compute@developer.gserviceaccount.com</code>.</p>
    <button type="button" disabled={pending || (!file && !documentUrl.trim())} onClick={()=>void analyze()}>{pending?'מזהה תיאורים…':'זיהוי תיאורים במסמך'}</button><p role="status">{message}</p>
    {reviews.length>0 && <><div className="description-review"><table><thead><tr><th>נמצא במסמך</th><th>שיוך לקורס</th><th>תיאור לעריכה</th></tr></thead><tbody>{reviews.map((review,index)=>{const target=candidates.find(candidate=>candidate.id===review.selectedCourseId);return <tr key={index}><td><strong>{review.sourceCourseName||'ללא שם'}</strong><small>{review.sourceTeacherName&&` · ${review.sourceTeacherName}`}</small><span>{review.match==='clear'?'התאמה מוצעת':'נדרשת בדיקה'}</span></td><td><select aria-label={`שיוך תיאור ${index+1}`} value={review.selectedCourseId} onChange={e=>setReviews(values=>values.map((value,i)=>i===index?{...value,selectedCourseId:e.target.value,replaceExisting:false}:value))}><option value="">ללא שיוך</option>{candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.clusterLabel} · {candidate.label}</option>)}</select>{target?.description.trim()&&<label><input type="checkbox" checked={review.replaceExisting} onChange={e=>setReviews(values=>values.map((value,i)=>i===index?{...value,replaceExisting:e.target.checked}:value))}/>החלפת התיאור הקיים</label>}</td><td><textarea rows={6} maxLength={4000} aria-label={`עריכת תיאור ${index+1}`} value={review.description} onChange={e=>setReviews(values=>values.map((value,i)=>i===index?{...value,description:e.target.value}:value))}/></td></tr>})}</tbody></table></div><button type="button" className="primary-action" onClick={apply}>החלת התיאורים שנבחרו</button></>}
  </details>
}
