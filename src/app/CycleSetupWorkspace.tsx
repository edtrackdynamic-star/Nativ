import { useEffect, useState } from 'react'
import { useUnsavedChanges, useConfirmAction } from './interaction'
import type { AssignmentCycle } from '../domain/cycle'
import type { ClusterSnapshot, ClusterPreference } from '../domain/preferences'
import { defaultFormDesign, parseFormDesign, safeLink, type FormDesign } from '../domain/formDesign'
import { ChoiceForm } from './ChoiceForm'
import { createCycle, getCycleCatalog, listEligibleInstructors, saveCycleCatalog, type CatalogClusterDraft, type CatalogCourseDraft } from './firebaseApi'

const emptyCourse = (): CatalogCourseDraft => ({ label: '', description: '', documentUrl:'', imageUrl:'', subjectArea: '', instructorIds: [], minimum: 0, target: 18, maximum: 22, repeatPolicy: 'allowed' })
const emptyCluster = (): CatalogClusterDraft => ({ label: '', description:'', rationaleMode:'optional', requiredRankingCount: 1, balanceByClass: false, courses: [emptyCourse()] })
function move<T>(list:T[], index:number, direction:number) { const next=[...list]; const target=index+direction; if(target<0 || target>=list.length) return list; [next[index],next[target]]=[next[target],next[index]];return next }

export function CycleSetupWorkspace({ cycle, onChanged, readOnly = false }: { cycle?: AssignmentCycle; onChanged: (createdId?: string) => Promise<void>; readOnly?: boolean }) {
  const { confirm, confirmation } = useConfirmAction()
  const [savedSignature,setSavedSignature]=useState('')
  const [schoolYear,setSchoolYear]=useState(''); const [termLabel,setTermLabel]=useState('')
  const [clusters,setClusters]=useState<CatalogClusterDraft[]>([emptyCluster()])
  const [design,setDesign]=useState<FormDesign>(defaultFormDesign)
  const [instructors,setInstructors]=useState<Array<{uid:string;displayName:string}>>([])
  const [message,setMessage]=useState(''); const [pending,setPending]=useState(false); const [loaded,setLoaded]=useState(false)
  const [tab,setTab]=useState<'courses'|'design'|'preview'>('courses')
  const [previewClusters,setPreviewClusters]=useState<ClusterSnapshot[]>([])
  const [previewPreferences,setPreviewPreferences]=useState<ClusterPreference[]>([])
  const [device,setDevice]=useState<'desktop'|'mobile'>('desktop')
  const [previewMessage,setPreviewMessage]=useState('')
  const locked = readOnly || Boolean(cycle && cycle.status !== 'draft')
  const signature=JSON.stringify({clusters,design})
  useUnsavedChanges(!locked && (cycle ? loaded && signature!==savedSignature : Boolean(schoolYear || termLabel)))
  const cycleId=cycle?.id
  useEffect(()=>{ if(!cycleId)return;let active=true;void Promise.all([listEligibleInstructors(),getCycleCatalog(cycleId)]).then(([teachers,data])=>{
    if(!active)return;setInstructors(teachers)
    const next=data.catalog?.clusters.length ? data.catalog.clusters.map(cluster=>({label:cluster.label,description:cluster.description??'',rationaleMode:cluster.rationaleMode??'optional',requiredRankingCount:cluster.requiredRankingCount,balanceByClass:cluster.balanceByClass===true,courses:data.courses.filter(course=>course.clusterId===cluster.clusterId).map(course=>({label:course.label,description:course.description,documentUrl:course.documentUrl??'',imageUrl:course.imageUrl??'',subjectArea:course.subjectArea,instructorIds:course.instructorIds,minimum:course.capacity.minimum,target:course.capacity.target,maximum:course.capacity.maximum,repeatPolicy:course.repeatPolicy}))})) : [emptyCluster()]
    const form={...defaultFormDesign,...data.catalog?.formDesign};setClusters(next);setDesign(form);setSavedSignature(JSON.stringify({clusters:next,design:form}));setLoaded(true)
  }).catch(()=>{if(active)setMessage('לא ניתן לטעון את הגדרות התהליך. נסו לפתוח אותו מחדש.')});return()=>{active=false}
  },[cycleId])
  async function create(){if(pending)return;try{setPending(true);const created=await createCycle(schoolYear.trim(),termLabel.trim());await onChanged(created.id)}catch(error){setMessage(error instanceof Error?error.message:'יצירת התהליך נכשלה')}finally{setPending(false)}}
  function updateCluster(index:number,patch:Partial<CatalogClusterDraft>){setClusters(items=>items.map((item,i)=>i===index?{...item,...patch}:item))}
  function updateCourse(ci:number,ti:number,patch:Partial<CatalogCourseDraft>){updateCluster(ci,{courses:clusters[ci].courses.map((item,i)=>i===ti?{...item,...patch}:item)})}
  async function save(){if(!cycle || pending || locked)return;try{setPending(true);const form=parseFormDesign(design);await saveCycleCatalog(cycle.id,clusters,form,cycle.version);setSavedSignature(signature);await onChanged();setMessage('הטופס והקורסים נשמרו. אפשר לעבור לניהול השיבוץ ולפתוח את הבחירה.')}catch(error){setMessage(error instanceof Error?error.message:'השמירה נכשלה')}finally{setPending(false)}}
  function preview(){try{parseFormDesign(design);const values=clusters.map((cluster,i)=>({clusterId:String(i),label:cluster.label||'מקבץ ללא שם',description:cluster.description,rationaleMode:cluster.rationaleMode,requiredRankingCount:cluster.requiredRankingCount,courses:cluster.courses.map((course,j)=>({courseId:i+'-'+j,logicalCourseId:i+'-'+j,label:course.label||'קורס ללא שם',description:course.description,documentUrl:safeLink(course.documentUrl,true),imageUrl:safeLink(course.imageUrl),instructorNames:course.instructorIds.map(id=>instructors.find(t=>t.uid===id)?.displayName??'מורה')}))}));setPreviewClusters(values);setPreviewPreferences(values.map(c=>({clusterId:c.clusterId,rankings:Array.from({length:c.requiredRankingCount},(_,i)=>({rank:i+1,courseId:''}))})));setPreviewMessage('');setTab('preview')}catch(error){setMessage(error instanceof Error?error.message:'בדקו את פרטי הטופס')}}
  if(!cycle)return <section className="workspace-card"><h2>יצירת תהליך בחירה</h2><form onSubmit={event=>{event.preventDefault();void create()}}><div className="setup-grid"><label>שנת לימודים<input required value={schoolYear} onChange={e=>setSchoolYear(e.target.value)} placeholder="לדוגמה: תשפ״ז" /></label><label>שם התהליך / תקופה<input required value={termLabel} onChange={e=>setTermLabel(e.target.value)} placeholder="לדוגמה: קורסי בחירה במחצית א׳" /></label></div><button className="primary-action" disabled={pending || readOnly}>יצירת התהליך והמשך להגדרות</button></form><p role="status">{message}</p></section>
  return <section className="workspace-card"><h2>עריכת תהליך הבחירה</h2>{confirmation}<p role="status">{message}</p>
    {locked && <p className="read-only-notice">הטופס פתוח לצפייה. לשינוי מבנה הבחירה יש ליצור תהליך חדש, כדי לשמור על הבחירות הקיימות.</p>}
    <nav className="role-navigation" aria-label="עריכת טופס">{(['courses','design'] as const).map(id=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{id==='courses'?'מקבצים וקורסים':'עיצוב והוראות'}</button>)}<button className={tab==='preview'?'active':''} onClick={preview} disabled={!loaded}>תצוגת תלמיד</button></nav>
    {!loaded ? <p>טוען את הטופס…</p> : <>
    <fieldset className="workspace-boundary" disabled={locked || pending}>
    {tab==='design' && <div className="form-editor setup-grid">
      <label>כותרת הטופס<input maxLength={150} value={design.title} onChange={e=>setDesign({...design,title:e.target.value})}/></label>
      <label>טקסט כפתור ההגשה<input maxLength={60} value={design.submitLabel} onChange={e=>setDesign({...design,submitLabel:e.target.value})}/></label>
      <label>פתיח<textarea rows={4} maxLength={4000} value={design.introduction} onChange={e=>setDesign({...design,introduction:e.target.value})}/></label>
      <label>הוראות לבחירה<textarea rows={4} maxLength={2000} value={design.instructions} onChange={e=>setDesign({...design,instructions:e.target.value})}/></label>
      <label>מסמך Google Docs עם תכני התהליך<input type="url" value={design.documentUrl} onChange={e=>setDesign({...design,documentUrl:e.target.value})}/></label>
      <label>קישור לתמונת פתיחה<input type="url" value={design.coverUrl} onChange={e=>setDesign({...design,coverUrl:e.target.value})}/></label>
      <label>צבע מוביל<select value={design.theme} onChange={e=>setDesign({...design,theme:e.target.value as FormDesign['theme']})}><option value="blue">כחול</option><option value="teal">טורקיז</option><option value="purple">סגול</option></select></label>
      <label>תצוגת הקורסים<select value={design.layout} onChange={e=>setDesign({...design,layout:e.target.value as FormDesign['layout']})}><option value="cards">כרטיסים</option><option value="list">רשימה</option></select></label>
    </div>}
    {tab==='courses' && <>{clusters.map((cluster,ci)=><article className="setup-cluster" key={ci}>
      <div className="workspace-heading"><h3>מקבץ {ci+1}: {cluster.label}</h3><div className="workspace-actions"><button type="button" disabled={ci===0} onClick={()=>setClusters(move(clusters,ci,-1))}>הזזה למעלה</button><button type="button" disabled={ci===clusters.length-1} onClick={()=>setClusters(move(clusters,ci,1))}>הזזה למטה</button></div></div>
      <div className="setup-grid"><label>שם המקבץ<input value={cluster.label} onChange={e=>updateCluster(ci,{label:e.target.value})}/></label><label>מספר קורסים לדירוג<input type="number" min={1} max={cluster.courses.length} value={cluster.requiredRankingCount} onChange={e=>updateCluster(ci,{requiredRankingCount:Math.max(1,Math.min(cluster.courses.length,Number(e.target.value)))})}/></label><label>הסבר לבחירה<select value={cluster.rationaleMode??'optional'} onChange={e=>updateCluster(ci,{rationaleMode:e.target.value as CatalogClusterDraft['rationaleMode']})}><option value="optional">שדה רשות</option><option value="required">שדה חובה</option><option value="hidden">ללא שדה הסבר</option></select></label><label>הוראות למקבץ<textarea value={cluster.description??''} onChange={e=>updateCluster(ci,{description:e.target.value})}/></label></div>
      <label className="setup-option"><input type="checkbox" checked={cluster.balanceByClass} onChange={e=>updateCluster(ci,{balanceByClass:e.target.checked})}/>איזון לפי כיתת מקור</label>
      {cluster.courses.map((course,ti)=><section className="setup-course" key={ti}><h4>קורס {ti+1}</h4><div className="setup-grid">
        <label>שם הקורס<input value={course.label} onChange={e=>updateCourse(ci,ti,{label:e.target.value})}/></label>
        <label>תחום דעת<input value={course.subjectArea} onChange={e=>updateCourse(ci,ti,{subjectArea:e.target.value})}/></label>
        <label>תיאור הקורס<textarea rows={3} value={course.description} onChange={e=>updateCourse(ci,ti,{description:e.target.value})}/></label>
        <label>מסמך Google Docs עם תכני הקורס<input type="url" value={course.documentUrl??''} onChange={e=>updateCourse(ci,ti,{documentUrl:e.target.value})}/></label>
        <label>קישור לתמונת הקורס<input type="url" value={course.imageUrl??''} onChange={e=>updateCourse(ci,ti,{imageUrl:e.target.value})}/></label>
        <fieldset className="teacher-picker"><legend>מורים מנחים</legend>{instructors.length ? instructors.map(teacher=><label key={teacher.uid}><input type="checkbox" checked={course.instructorIds.includes(teacher.uid)} onChange={e=>updateCourse(ci,ti,{instructorIds:e.target.checked?[...course.instructorIds,teacher.uid]:course.instructorIds.filter(id=>id!==teacher.uid)})}/>{teacher.displayName}</label>) : <p>לא נמצאו מורים פעילים בבית הספר.</p>}</fieldset>
        {(['minimum','target','maximum'] as const).map((field,i)=><label key={field}>{['מינימום תלמידים','יעד תלמידים','מקסימום תלמידים'][i]}<input type="number" min={field==='maximum'?1:0} value={course[field]} onChange={e=>updateCourse(ci,ti,{[field]:Number(e.target.value)})}/></label>)}
        <label>חזרה על הקורס<select value={course.repeatPolicy} onChange={e=>updateCourse(ci,ti,{repeatPolicy:e.target.value as CatalogCourseDraft['repeatPolicy']})}><option value="allowed">מותרת</option><option value="approval_required">דורשת אישור</option><option value="discouraged">לא מומלצת</option><option value="prohibited">אסורה</option></select></label>
      </div><div className="workspace-actions"><button type="button" disabled={ti===0} onClick={()=>updateCluster(ci,{courses:move(cluster.courses,ti,-1)})}>הזזת קורס למעלה</button><button type="button" disabled={ti===cluster.courses.length-1} onClick={()=>updateCluster(ci,{courses:move(cluster.courses,ti,1)})}>הזזת קורס למטה</button>{cluster.courses.length>1 && <button type="button" onClick={async()=>{if(await confirm('להסיר את הקורס?'))updateCluster(ci,{courses:cluster.courses.filter((_,i)=>i!==ti),requiredRankingCount:Math.min(cluster.requiredRankingCount,cluster.courses.length-1)})}}>הסרת קורס</button>}</div></section>)}
      <div className="workspace-actions"><button type="button" className="secondary-action" onClick={()=>updateCluster(ci,{courses:[...cluster.courses,emptyCourse()]})}>הוספת קורס</button>{clusters.length>1 && <button type="button" className="text-action" onClick={async()=>{if(await confirm('להסיר את המקבץ והקורסים שבתוכו?'))setClusters(clusters.filter((_,i)=>i!==ci))}}>הסרת מקבץ</button>}</div>
    </article>)}<button className="secondary-action" onClick={()=>setClusters([...clusters,emptyCluster()])}>הוספת מקבץ</button></>}
    {tab!=='preview' && !locked && <div className="editor-save"><button className="primary-action" onClick={()=>void save()}>שמירת הטופס והקורסים</button><span>{signature===savedSignature?'כל השינויים נשמרו':'יש שינויים שלא נשמרו'}</span></div>}
    </fieldset>
    {tab==='preview' && <div><div className="workspace-actions"><button className="secondary-action" aria-pressed={device==='desktop'} onClick={()=>setDevice('desktop')}>מחשב</button><button className="secondary-action" aria-pressed={device==='mobile'} onClick={()=>setDevice('mobile')}>נייד</button></div><p>תצוגה מקדימה — ההתנסות אינה שומרת בחירות של תלמידים.</p><p role="status">{previewMessage}</p><div className={`student-preview ${device}`}><ChoiceForm clusters={previewClusters} design={parseFormDesign(design)} preferences={previewPreferences} onChange={setPreviewPreferences} onSubmit={()=>setPreviewMessage('הטופס תקין ומוכן להגשה. לא נשלחה הגשה אמיתית.')} preview /></div></div>}
    </>}
  </section>
}
