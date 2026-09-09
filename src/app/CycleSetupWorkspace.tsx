import { CourseTableImport } from './CourseTableImport'
import { InstructorPicker } from './InstructorPicker'
import { capacityError } from '../domain/tablePaste'
import { currentSchoolYearStart, schoolYearId, schoolYearOptions } from '../domain/schoolYear'
import { useEffect, useState } from 'react'
import { useUnsavedChanges, useConfirmAction } from './interaction'
import type { AssignmentCycle } from '../domain/cycle'
import type { ClusterSnapshot, ClusterPreference } from '../domain/preferences'
import { defaultFormDesign, parseFormDesign, safeLink, type FormDesign } from '../domain/formDesign'
import { includesClass } from '../domain/classEligibility'
import { ChoiceForm } from './ChoiceForm'
import { createCycle, getCycleCatalog, listEligibleClasses, listEligibleInstructors, saveCycleCatalog, type CatalogClusterDraft, type CatalogCourseDraft } from './firebaseApi'

type CourseEdit = Omit<CatalogCourseDraft, 'minimum' | 'target' | 'maximum'> & { minimum: number | string; target: number | string; maximum: number | string }
type ClusterEdit = Omit<CatalogClusterDraft, 'courses' | 'requiredRankingCount'> & { courses: CourseEdit[]; requiredRankingCount: number | string }
const emptyCourse = (): CourseEdit => ({ label: '', description: '', documentUrl:'', imageUrl:'', subjectArea: '', instructorIds: [], minimum: 0, target: 18, maximum: 22, repeatPolicy: 'allowed' })
const emptyCluster = (): ClusterEdit => ({ label: '', description:'', rationaleMode:'optional', requiredRankingCount: 1, balanceByClass: false, courses: [emptyCourse()] })
function move<T>(list:T[], index:number, direction:number) { const next=[...list]; const target=index+direction; if(target<0 || target>=list.length) return list; [next[index],next[target]]=[next[target],next[index]];return next }

export function CycleSetupWorkspace({ cycle, onChanged, readOnly = false }: { cycle?: AssignmentCycle; onChanged: (createdId?: string) => Promise<void>; readOnly?: boolean }) {
  const { confirm, confirmation } = useConfirmAction()
  const [savedSignature,setSavedSignature]=useState('')
  const [initialSchoolYear]=useState(()=>schoolYearId(currentSchoolYearStart())); const [schoolYear,setSchoolYear]=useState(initialSchoolYear); const [termLabel,setTermLabel]=useState('')
  const [clusters,setClusters]=useState<ClusterEdit[]>([emptyCluster()])
  const [design,setDesign]=useState<FormDesign>(defaultFormDesign)
  const [classes,setClasses]=useState<Array<{id:string;name:string}>>([])
  const [previewClass,setPreviewClass]=useState('*')
  const [instructors,setInstructors]=useState<Array<{uid:string;displayName:string}>>([])
  const [message,setMessage]=useState(''); const [pending,setPending]=useState(false); const [loaded,setLoaded]=useState(false)
  const [tab,setTab]=useState<'courses'|'design'|'preview'>('courses')
  const [previewClusters,setPreviewClusters]=useState<ClusterSnapshot[]>([])
  const [previewPreferences,setPreviewPreferences]=useState<ClusterPreference[]>([])
  const [device,setDevice]=useState<'desktop'|'mobile'>('desktop')
  const [previewMessage,setPreviewMessage]=useState('')
  const locked = readOnly || Boolean(cycle && cycle.status !== 'draft')
  const signature=JSON.stringify({clusters,design})
  useUnsavedChanges(!locked && (cycle ? loaded && signature!==savedSignature : Boolean(schoolYear!==initialSchoolYear || termLabel)))
  const cycleId=cycle?.id
  useEffect(()=>{ if(!cycleId)return;let active=true;void Promise.all([listEligibleInstructors(),getCycleCatalog(cycleId),listEligibleClasses()]).then(([teachers,data,schoolClasses])=>{
    if(!active)return;setInstructors(teachers);setClasses(schoolClasses)
    const next=data.catalog?.clusters.length ? data.catalog.clusters.map(cluster=>({...(cluster.eligibleClassIds===undefined?{}:{eligibleClassIds:cluster.eligibleClassIds}),label:cluster.label,description:cluster.description??'',rationaleMode:cluster.rationaleMode??'optional',requiredRankingCount:cluster.requiredRankingCount,balanceByClass:cluster.balanceByClass===true,courses:data.courses.filter(course=>course.clusterId===cluster.clusterId).map(course=>({label:course.label,description:course.description,documentUrl:course.documentUrl??'',imageUrl:course.imageUrl??'',subjectArea:course.subjectArea,instructorIds:course.instructorIds,minimum:course.capacity.minimum,target:course.capacity.target,maximum:course.capacity.maximum,repeatPolicy:course.repeatPolicy}))})) : [emptyCluster()]
    const form={...defaultFormDesign,...data.catalog?.formDesign};setClusters(next);setDesign(form);setSavedSignature(JSON.stringify({clusters:next,design:form}));setLoaded(true)
  }).catch(()=>{if(active)setMessage('לא ניתן לטעון את הגדרות התהליך. נסו לפתוח אותו מחדש.')});return()=>{active=false}
  },[cycleId])
  async function create(){if(pending)return;try{setPending(true);const created=await createCycle(schoolYear.trim(),termLabel.trim());await onChanged(created.id)}catch(error){setMessage(error instanceof Error?error.message:'יצירת התהליך נכשלה')}finally{setPending(false)}}
  function updateCluster(index:number,patch:Partial<ClusterEdit>){setClusters(items=>items.map((item,i)=>{if(i!==index)return item;const next={...item,...patch};if(next.eligibleClassIds===undefined)delete next.eligibleClassIds;return next}))}
  function updateCourse(ci:number,ti:number,patch:Partial<CourseEdit>){updateCluster(ci,{courses:clusters[ci].courses.map((item,i)=>i===ti?{...item,...patch}:item)})}
  function validatedClusters(): CatalogClusterDraft[] {
    if (clusters.length > 20 || clusters.some(cluster => cluster.courses.length > 40)) throw new Error('אפשר להגדיר עד 20 מקבצים ועד 40 קורסים בכל מקבץ.')
    return clusters.map(cluster => {
      const count = Number(cluster.requiredRankingCount)
      if (!Number.isInteger(count) || count < 1 || count > cluster.courses.length) throw new Error('יש לבחור מספר קורסים לדירוג בין 1 למספר הקורסים במקבץ ' + cluster.label)
      return {...cluster, requiredRankingCount: count, courses: cluster.courses.map(course => {
        const error = capacityError(course.minimum, course.target, course.maximum)
        if (error) throw new Error('בקורס ' + (course.label || 'ללא שם') + ': ' + error)
        return {...course, minimum:Number(course.minimum), target:Number(course.target), maximum:Number(course.maximum)}
      })}
    })
  }
  async function save(){if(!cycle || pending || locked)return;try{if(clusters.some(c=>c.eligibleClassIds?.length===0))throw new Error('יש לבחור כיתה אחת לפחות לכל מקבץ, או לבחור בכל הכיתות.');setPending(true);const form=parseFormDesign(design);await saveCycleCatalog(cycle.id,validatedClusters(),form,cycle.version);setSavedSignature(signature);await onChanged();setMessage('הטופס והקורסים נשמרו. אפשר לעבור לניהול השיבוץ ולפתוח את הבחירה.')}catch(error){setMessage(error instanceof Error?error.message:'השמירה נכשלה')}finally{setPending(false)}}
  function preview(classId=previewClass){try{parseFormDesign(design);const values=validatedClusters().map((cluster,i)=>({eligibleClassIds:cluster.eligibleClassIds,clusterId:String(i),label:cluster.label||'מקבץ ללא שם',description:cluster.description,rationaleMode:cluster.rationaleMode,requiredRankingCount:cluster.requiredRankingCount,courses:cluster.courses.map((course,j)=>({courseId:i+'-'+j,logicalCourseId:i+'-'+j,label:course.label||'קורס ללא שם',description:course.description,documentUrl:safeLink(course.documentUrl,true),imageUrl:safeLink(course.imageUrl),instructorNames:course.instructorIds.map(id=>instructors.find(t=>t.uid===id)?.displayName??'מורה')}))}));const visible=classId==='*'?values:values.filter(c=>includesClass(c,classId));setPreviewClass(classId);setPreviewClusters(visible);setPreviewPreferences(visible.map(c=>({clusterId:c.clusterId,rankings:Array.from({length:c.requiredRankingCount},(_,i)=>({rank:i+1,courseId:''}))})));setPreviewMessage('');setTab('preview')}catch(error){setMessage(error instanceof Error?error.message:'בדקו את פרטי הטופס')}}
  if(!cycle)return <section className="workspace-card"><h2>יצירת תהליך בחירה</h2><form onSubmit={event=>{event.preventDefault();void create()}}><div className="setup-grid"><label>שנת לימודים<select required value={schoolYear} onChange={e=>setSchoolYear(e.target.value)}>{schoolYearOptions().map(year=><option key={year.id} value={year.id}>{year.label}</option>)}</select></label><label>שם התהליך / תקופה<input required value={termLabel} onChange={e=>setTermLabel(e.target.value)} placeholder="לדוגמה: קורסי בחירה במחצית א׳" /></label></div><button className="primary-action" disabled={pending || readOnly}>יצירת התהליך והמשך להגדרות</button></form><p role="status">{message}</p></section>
  return <section className="workspace-card"><h2>עריכת תהליך הבחירה</h2>{confirmation}<p role="status">{message}</p>
    {locked && <p className="read-only-notice">הטופס פתוח לצפייה. לשינוי מבנה הבחירה יש ליצור תהליך חדש, כדי לשמור על הבחירות הקיימות.</p>}
    <nav className="role-navigation" aria-label="עריכת טופס">{(['courses','design'] as const).map(id=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{id==='courses'?'מקבצים וקורסים':'עיצוב והוראות'}</button>)}<button className={tab==='preview'?'active':''} onClick={()=>preview()} disabled={!loaded}>תצוגת תלמיד</button></nav>
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
    <div hidden={tab!=='courses'}><CourseTableImport instructors={instructors} availableClusters={20-clusters.length} onAdd={added=>setClusters(current=>[...current,...added])}/></div>
    {tab==='courses' && <>{clusters.map((cluster,ci)=><article className="setup-cluster" key={ci}>
      <div className="workspace-heading"><h3>מקבץ {ci+1}: {cluster.label}</h3><div className="workspace-actions"><button type="button" disabled={ci===0} onClick={()=>setClusters(move(clusters,ci,-1))}>הזזה למעלה</button><button type="button" disabled={ci===clusters.length-1} onClick={()=>setClusters(move(clusters,ci,1))}>הזזה למטה</button></div></div>
      <div className="setup-grid"><label>שם המקבץ<input value={cluster.label} onChange={e=>updateCluster(ci,{label:e.target.value})}/></label><label>מספר קורסים לדירוג<input type="number" min={1} max={cluster.courses.length} value={cluster.requiredRankingCount} onChange={e=>updateCluster(ci,{requiredRankingCount:e.target.value})}/></label><label>הסבר לבחירה<select value={cluster.rationaleMode??'optional'} onChange={e=>updateCluster(ci,{rationaleMode:e.target.value as CatalogClusterDraft['rationaleMode']})}><option value="optional">שדה רשות</option><option value="required">שדה חובה</option><option value="hidden">ללא שדה הסבר</option></select></label><label>הוראות למקבץ<textarea value={cluster.description??''} onChange={e=>updateCluster(ci,{description:e.target.value})}/></label></div>
      <fieldset className="teacher-picker"><legend>כיתות משתתפות</legend>
        <label><input type="checkbox" checked={cluster.eligibleClassIds===undefined} onChange={e=>updateCluster(ci,{eligibleClassIds:e.target.checked?undefined:[]})}/>כל הכיתות</label>
        {classes.map(schoolClass=><label key={schoolClass.id}><input type="checkbox" checked={cluster.eligibleClassIds===undefined || cluster.eligibleClassIds.includes(schoolClass.id)} onChange={e=>{const selected=cluster.eligibleClassIds??classes.map(c=>c.id);updateCluster(ci,{eligibleClassIds:e.target.checked?[...selected,schoolClass.id]:selected.filter(id=>id!==schoolClass.id)})}}/>{schoolClass.name}</label>)}
        {!classes.length && <p>לא נמצאו כיתות פעילות בבית הספר.</p>}
        {cluster.eligibleClassIds?.filter(id=>!classes.some(c=>c.id===id)).map(id=><label key={id}><input type="checkbox" checked onChange={()=>updateCluster(ci,{eligibleClassIds:cluster.eligibleClassIds?.filter(value=>value!==id)})}/>כיתה שאינה פעילה ({id})</label>)}
        {cluster.eligibleClassIds?.length===0 && <p role="alert">יש לבחור כיתה אחת לפחות או לבחור בכל הכיתות.</p>}
      </fieldset>
      <label className="setup-option"><input type="checkbox" checked={cluster.balanceByClass} onChange={e=>updateCluster(ci,{balanceByClass:e.target.checked})}/>איזון לפי כיתת מקור</label>
      {cluster.courses.map((course,ti)=><section className="setup-course" key={ti}><h4>קורס {ti+1}</h4><div className="setup-grid">
        <label>שם הקורס<input value={course.label} onChange={e=>updateCourse(ci,ti,{label:e.target.value})}/></label>
        <label>תחום דעת<input value={course.subjectArea} onChange={e=>updateCourse(ci,ti,{subjectArea:e.target.value})}/></label>
        <label>תיאור הקורס<textarea rows={3} value={course.description} onChange={e=>updateCourse(ci,ti,{description:e.target.value})}/></label>
        <label>מסמך Google Docs עם תכני הקורס<input type="url" value={course.documentUrl??''} onChange={e=>updateCourse(ci,ti,{documentUrl:e.target.value})}/></label>
        <label>קישור לתמונת הקורס<input type="url" value={course.imageUrl??''} onChange={e=>updateCourse(ci,ti,{imageUrl:e.target.value})}/></label>
        <InstructorPicker instructors={instructors} selected={course.instructorIds} onChange={ids=>updateCourse(ci,ti,{instructorIds:ids})}/>
        {(['minimum','target','maximum'] as const).map((field,i)=><label key={field}>{['מינימום תלמידים','יעד תלמידים','מקסימום תלמידים'][i]}<input type="number" min={field==='maximum'?1:0} value={course[field]} onChange={e=>updateCourse(ci,ti,{[field]:e.target.value})}/></label>)}
        <label>חזרה על הקורס<select value={course.repeatPolicy} onChange={e=>updateCourse(ci,ti,{repeatPolicy:e.target.value as CatalogCourseDraft['repeatPolicy']})}><option value="allowed">מותרת</option><option value="approval_required">דורשת אישור</option><option value="discouraged">לא מומלצת</option><option value="prohibited">אסורה</option></select></label>
      </div><div className="workspace-actions"><button type="button" disabled={ti===0} onClick={()=>updateCluster(ci,{courses:move(cluster.courses,ti,-1)})}>הזזת קורס למעלה</button><button type="button" disabled={ti===cluster.courses.length-1} onClick={()=>updateCluster(ci,{courses:move(cluster.courses,ti,1)})}>הזזת קורס למטה</button>{cluster.courses.length>1 && <button type="button" onClick={async()=>{if(await confirm('להסיר את הקורס?'))updateCluster(ci,{courses:cluster.courses.filter((_,i)=>i!==ti),requiredRankingCount:Math.min(Number(cluster.requiredRankingCount),cluster.courses.length-1)})}}>הסרת קורס</button>}</div></section>)}
      <div className="workspace-actions"><button type="button" className="secondary-action" onClick={()=>updateCluster(ci,{courses:[...cluster.courses,emptyCourse()]})}>הוספת קורס</button>{clusters.length>1 && <button type="button" className="text-action" onClick={async()=>{if(await confirm('להסיר את המקבץ והקורסים שבתוכו?'))setClusters(clusters.filter((_,i)=>i!==ci))}}>הסרת מקבץ</button>}</div>
    </article>)}<button className="secondary-action" onClick={()=>setClusters([...clusters,emptyCluster()])}>הוספת מקבץ</button></>}
    {tab!=='preview' && !locked && <div className="editor-save"><button className="primary-action" onClick={()=>void save()}>שמירת הטופס והקורסים</button><span>{signature===savedSignature?'כל השינויים נשמרו':'יש שינויים שלא נשמרו'}</span></div>}
    </fieldset>
    {tab==='preview' && <div><div className="setup-grid"><label>תצוגה לפי כיתה<select value={previewClass} onChange={e=>preview(e.target.value)}><option value="*">כל המקבצים</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="">ללא שיוך לכיתה</option></select></label></div>{!previewClusters.length && <p>אין מקבצים פתוחים לכיתה זו.</p>}<div className="workspace-actions"><button className="secondary-action" aria-pressed={device==='desktop'} onClick={()=>setDevice('desktop')}>מחשב</button><button className="secondary-action" aria-pressed={device==='mobile'} onClick={()=>setDevice('mobile')}>נייד</button></div><p>תצוגה מקדימה — ההתנסות אינה שומרת בחירות של תלמידים.</p><p role="status">{previewMessage}</p><div className={`student-preview ${device}`}>{previewClusters.length>0 && <ChoiceForm clusters={previewClusters} design={parseFormDesign(design)} preferences={previewPreferences} onChange={setPreviewPreferences} onSubmit={()=>setPreviewMessage('הטופס תקין ומוכן להגשה. לא נשלחה הגשה אמיתית.')} preview />}</div></div>}
    </>}
  </section>
}
