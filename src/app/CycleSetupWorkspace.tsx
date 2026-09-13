import { CapacityPlanner } from './CapacityPlanner'
import { CourseDescriptionImport } from './CourseDescriptionImport'
import type { StudentRosterEntry } from '../domain/studentRoster'
import { CourseTableImport } from './CourseTableImport'
import { InstructorPicker } from './InstructorPicker'
import { WeeklySlotFields } from './WeeklySlotFields'
import { WeeklyScheduleEditor } from './WeeklyScheduleEditor'
import { capacityError } from '../domain/tablePaste'
import { currentSchoolYearStart, schoolYearId, schoolYearOptions } from '../domain/schoolYear'
import { useEffect, useState } from 'react'
import { useUnsavedChanges, useConfirmAction } from './interaction'
import type { AssignmentCycle } from '../domain/cycle'
import type { ClusterSnapshot, ClusterPreference } from '../domain/preferences'
import { defaultFormDesign, parseFormDesign, safeLink, type FormDesign } from '../domain/formDesign'
import { includesClass } from '../domain/classEligibility'
import { minimumRankingCount, rankingCountAfterCourseChange, validRankingCount } from '../domain/rankingPolicy'
import { ChoiceForm } from './ChoiceForm'
import { formatIsraelDateTime, fromIsraelDateTimeInput, toIsraelDateTimeInput } from './israelDateTime'
import { createCycle, downloadCycleDocument, getCycle, getStudentRoster, getCycleCatalog, listEligibleClasses, listEligibleInstructors, saveCycleCatalog, setChoiceDeadline, transitionCycle, type CatalogClusterDraft, type CatalogCourseDraft } from './firebaseApi'

type CourseEdit = Omit<CatalogCourseDraft, 'minimum' | 'target' | 'maximum'> & { minimum: number | string; target: number | string; maximum: number | string }
type ClusterEdit = Omit<CatalogClusterDraft, 'courses' | 'requiredRankingCount'> & { courses: CourseEdit[]; requiredRankingCount: number | string }
const emptyCourse = (): CourseEdit => ({ label: '', description: '', documentUrl:'', imageUrl:'', subjectArea: '', instructorIds: [], minimum: 0, target: 18, maximum: 22, repeatPolicy: 'allowed' })
const emptyCluster = (): ClusterEdit => ({ label: '', description:'', rationaleMode:'optional', requiredRankingCount: 1, balanceByClass: false, courses: [emptyCourse()] })
function move<T>(list:T[], index:number, direction:number) { const next=[...list]; const target=index+direction; if(target<0 || target>=list.length) return list; [next[index],next[target]]=[next[target],next[index]];return next }

export function CycleSetupWorkspace({ cycle, onChanged, readOnly = false, schoolName, schoolLogo }: { cycle?: AssignmentCycle; onChanged: (createdId?: string) => Promise<void>; readOnly?: boolean; schoolName?: string; schoolLogo?: string }) {
  const { confirm, confirmation } = useConfirmAction()
  const [savedSignature,setSavedSignature]=useState('')
  const [catalogSaved,setCatalogSaved]=useState(false)
  const [deadlineInput,setDeadlineInput]=useState(()=>toIsraelDateTimeInput(cycle?.choiceDeadlineEnabled ? cycle.choiceClosesAt : undefined))
  const [savedDeadline,setSavedDeadline]=useState(()=>toIsraelDateTimeInput(cycle?.choiceDeadlineEnabled ? cycle.choiceClosesAt : undefined))
  const [initialSchoolYear]=useState(()=>schoolYearId(currentSchoolYearStart())); const [schoolYear,setSchoolYear]=useState(initialSchoolYear); const [termLabel,setTermLabel]=useState('')
  const [clusters,setClusters]=useState<ClusterEdit[]>([emptyCluster()])
  const [design,setDesign]=useState<FormDesign>(defaultFormDesign)
  const [rosterResult,setRoster]=useState<{cycleId:string;students:StudentRosterEntry[]}|null>(null)
  const [classes,setClasses]=useState<Array<{id:string;name:string}>>([])
  const [previewClass,setPreviewClass]=useState('*')
  const [instructors,setInstructors]=useState<Array<{uid:string;displayName:string}>>([])
  const [message,setMessage]=useState(''); const [pending,setPending]=useState(false); const [loaded,setLoaded]=useState(false)
  const [tab,setTab]=useState<'settings'|'preview'>('settings')
  const [previewClusters,setPreviewClusters]=useState<ClusterSnapshot[]>([])
  const [previewPreferences,setPreviewPreferences]=useState<ClusterPreference[]>([])
  const [device,setDevice]=useState<'desktop'|'mobile'>('desktop')
  const [previewMessage,setPreviewMessage]=useState('')
  const locked = readOnly || Boolean(cycle && cycle.status !== 'draft')
  const signature=JSON.stringify({clusters,design})
  const deadlineEditable = !readOnly && (cycle?.status === 'draft' || cycle?.status === 'choice_open')
  const deadlineDirty = deadlineInput !== savedDeadline
  useUnsavedChanges((!locked && (cycle ? loaded && signature!==savedSignature : Boolean(schoolYear!==initialSchoolYear || termLabel))) || (deadlineEditable && deadlineDirty))
  const cycleId=cycle?.id
  const roster=rosterResult?.cycleId===cycleId?rosterResult?.students??null:null
  useEffect(()=>{ if(!cycleId)return;let active=true;void Promise.all([listEligibleInstructors(),getCycleCatalog(cycleId),listEligibleClasses()]).then(([teachers,data,schoolClasses])=>{
    if(!active)return;setInstructors(teachers);setClasses(schoolClasses)
    const next=data.catalog?.clusters.length ? data.catalog.clusters.map(cluster=>({...(cluster.eligibleClassIds===undefined?{}:{eligibleClassIds:cluster.eligibleClassIds}),...(cluster.weeklySlot===undefined?{}:{weeklySlot:cluster.weeklySlot}),...(cluster.capacityFlexibility===undefined?{}:{capacityFlexibility:cluster.capacityFlexibility}),label:cluster.label,description:cluster.description??'',rationaleMode:cluster.rationaleMode??'optional',requiredRankingCount:cluster.requiredRankingCount,balanceByClass:cluster.balanceByClass===true,courses:data.courses.filter(course=>course.clusterId===cluster.clusterId).map(course=>({...(course.capacity.limit===undefined?{}:{capacityLimit:course.capacity.limit}),label:course.label,description:course.description,documentUrl:course.documentUrl??'',imageUrl:course.imageUrl??'',subjectArea:course.subjectArea,instructorIds:course.instructorIds,minimum:course.capacity.minimum,target:course.capacity.target,maximum:course.capacity.maximum,repeatPolicy:course.repeatPolicy}))})) : [emptyCluster()]
    const form={...defaultFormDesign,...data.catalog?.formDesign,documentLinkVisible:data.catalog?.formDesign?.documentLinkVisible??Boolean(data.catalog?.formDesign?.documentUrl || data.catalog?.formDesign?.documentStoragePath)};setClusters(next);setDesign(form);setSavedSignature(JSON.stringify({clusters:next,design:form}));setCatalogSaved(Boolean(data.catalog?.clusters.length));setLoaded(true)
  }).catch(()=>{if(active)setMessage('לא ניתן לטעון את הגדרות התהליך. נסו לפתוח אותו מחדש.')});return()=>{active=false}
  },[cycleId])
  useEffect(()=>{if(!cycleId)return;let active=true;void getStudentRoster(cycleId).then(values=>{if(active)setRoster({cycleId,students:values})}).catch(()=>{if(active)setRoster(null)});return()=>{active=false}},[cycleId])
  async function create(){if(pending)return;try{setPending(true);const created=await createCycle(schoolYear.trim(),termLabel.trim());await onChanged(created.id)}catch(error){setMessage(error instanceof Error?error.message:'יצירת התהליך נכשלה')}finally{setPending(false)}}
  function updateCluster(index:number,patch:Partial<ClusterEdit>){setClusters(items=>items.map((item,i)=>{if(i!==index)return item;const next={...item,...patch};if(patch.courses && patch.courses.length!==item.courses.length && patch.requiredRankingCount===undefined)next.requiredRankingCount=rankingCountAfterCourseChange(item.courses.length,Number(item.requiredRankingCount),patch.courses.length);if(next.eligibleClassIds===undefined)delete next.eligibleClassIds;return next}))}
  function updateCourse(ci:number,ti:number,patch:Partial<CourseEdit>){updateCluster(ci,{courses:clusters[ci].courses.map((item,i)=>i===ti?{...item,...patch}:item)})}
  function validatedClusters(): CatalogClusterDraft[] {
    if (clusters.length > 20 || clusters.some(cluster => cluster.courses.length > 40)) throw new Error('אפשר להגדיר עד 20 מקבצים ועד 40 קורסים בכל מקבץ.')
    return clusters.map(cluster => {
      if (!cluster.label.trim()) throw new Error('יש למלא שם לכל מקבץ לפני השמירה.')
      const count = Number(cluster.requiredRankingCount)
      if (!validRankingCount(cluster.courses.length,count)) throw new Error(`במקבץ ${cluster.label} יש לדרג לפחות ${minimumRankingCount(cluster.courses.length)} קורסים, ועד ${cluster.courses.length}.`)
      return {...cluster, requiredRankingCount: count, courses: cluster.courses.map(course => {
        if (!course.label.trim()) throw new Error(`יש למלא שם לקורס במקבץ ${cluster.label}.`)
        if (!course.instructorIds.length) throw new Error(`יש לשייך מורה לקורס ${course.label} במקבץ ${cluster.label}.`)
        const error = capacityError(course.minimum, course.target, course.maximum)
        if (error) throw new Error('בקורס ' + (course.label || 'ללא שם') + ': ' + error)
        return {...course, minimum:Number(course.minimum), target:Number(course.target), maximum:Number(course.maximum)}
      })}
    })
  }
  function checkedDeadline(){const value=deadlineInput ? fromIsraelDateTimeInput(deadlineInput) : null;if(value && new Date(value).getTime()<=Date.now())throw new Error('מועד סגירת הטופס חייב להיות בעתיד.');return value}
  async function saveDeadline(){if(!cycle || pending || !deadlineEditable || !deadlineDirty)return;try{const deadline=checkedDeadline();setPending(true);const current=await getCycle(cycle.id);await setChoiceDeadline(cycle.id,current.version,deadline);setSavedDeadline(deadlineInput);await onChanged();setMessage('מועד סגירת הטופס נשמר.')}catch(error){setMessage(error instanceof Error?error.message:'שמירת המועד נכשלה');setTab('settings')}finally{setPending(false)}}
  async function save(){if(!cycle || pending || locked)return;let catalogUpdated=false;try{const deadline=checkedDeadline();if(clusters.some(c=>c.eligibleClassIds?.length===0))throw new Error('יש לבחור כיתה אחת לפחות לכל מקבץ, או לבחור בכל הכיתות.');const form=parseFormDesign(design);const values=validatedClusters();setPending(true);if(!catalogSaved || signature!==savedSignature){await saveCycleCatalog(cycle.id,values,form,cycle.version);setSavedSignature(signature);setCatalogSaved(true);catalogUpdated=true}if(deadlineDirty){const updated=await getCycle(cycle.id);await setChoiceDeadline(cycle.id,updated.version,deadline);setSavedDeadline(deadlineInput)}await onChanged();setMessage('הטופס והקורסים נשמרו. אפשר לשלוח את הטופס לתלמידים.')}catch(error){if(catalogUpdated)await onChanged().catch(()=>undefined);const detail=error instanceof Error?error.message:'השמירה נכשלה';setMessage(catalogUpdated?`הטופס והקורסים נשמרו, אך מועד הסגירה לא נשמר: ${detail}`:detail);setTab('settings')}finally{setPending(false)}}
  function checkReady(){if(!loaded)throw new Error('הטופס עדיין נטען. נסו שוב בעוד רגע.');if(!catalogSaved)throw new Error('יש לשמור את הטופס והקורסים לפני השליחה.');if(signature!==savedSignature)throw new Error('יש שינויים שלא נשמרו. שמרו את הטופס והקורסים לפני השליחה.');if(deadlineDirty)throw new Error('מועד הסגירה השתנה. שמרו אותו לפני השליחה.');checkedDeadline();parseFormDesign(design);const values=validatedClusters();for(const [index,cluster] of values.entries()){if(!cluster.label.trim())throw new Error(`יש למלא שם למקבץ ${index+1}.`);if(cluster.eligibleClassIds?.length===0)throw new Error(`יש לבחור כיתות למקבץ ${cluster.label}.`);for(const [courseIndex,course] of cluster.courses.entries()){if(!course.label.trim())throw new Error(`יש למלא שם לקורס ${courseIndex+1} במקבץ ${cluster.label}.`);if(!course.instructorIds.length)throw new Error(`יש לשייך מורה לקורס ${course.label} במקבץ ${cluster.label}.`)}}}
  async function openChoice(){if(!cycle || pending || locked)return;try{checkReady();if(!(await confirm('לשלוח את הטופס לתלמידים? הטופס ייפתח בחשבונות התלמידים הזכאים. לאחר הפתיחה לא ניתן לשנות את המקבצים והקורסים.')))return;setPending(true);const current=await getCycle(cycle.id);if(current.status!=='draft' || current.version!==cycle.version)throw new Error('הטופס השתנה מאז הטעינה. רעננו את הדף ובדקו את הפרטים לפני השליחה.');await transitionCycle(current,'choice_open','פתיחת טופס הבחירה לתלמידים בידי רכז');await onChanged();setMessage('הטופס נפתח לתלמידים הזכאים בנתיב.')}catch(error){const detail=error instanceof Error?error.message:'פתיחת הטופס נכשלה';setMessage(detail);setTab('settings')}finally{setPending(false)}}
  function preview(classId=previewClass){try{parseFormDesign(design);const values=validatedClusters().map((cluster,i)=>({eligibleClassIds:cluster.eligibleClassIds,clusterId:String(i),label:cluster.label||'מקבץ ללא שם',description:cluster.description,rationaleMode:cluster.rationaleMode,requiredRankingCount:cluster.requiredRankingCount,courses:cluster.courses.map((course,j)=>({courseId:i+'-'+j,logicalCourseId:i+'-'+j,label:course.label||'קורס ללא שם',description:course.description,documentUrl:safeLink(course.documentUrl,true),imageUrl:safeLink(course.imageUrl),instructorNames:course.instructorIds.map(id=>instructors.find(t=>t.uid===id)?.displayName??'מורה')}))}));const visible=classId==='*'?values:values.filter(c=>includesClass(c,classId));setPreviewClass(classId);setPreviewClusters(visible);setPreviewPreferences(visible.map(c=>({clusterId:c.clusterId,rankings:Array.from({length:c.requiredRankingCount},(_,i)=>({rank:i+1,courseId:''}))})));setPreviewMessage('');setTab('preview')}catch(error){setMessage(error instanceof Error?error.message:'בדקו את פרטי הטופס')}}
  if(!cycle)return <section className="workspace-card"><h2>יצירת תהליך בחירה</h2><form onSubmit={event=>{event.preventDefault();void create()}}><div className="setup-grid"><label>שנת לימודים<select required value={schoolYear} onChange={e=>setSchoolYear(e.target.value)}>{schoolYearOptions().map(year=><option key={year.id} value={year.id}>{year.label}</option>)}</select></label><label>שם התהליך / תקופה<input required value={termLabel} onChange={e=>setTermLabel(e.target.value)} placeholder="לדוגמה: קורסי בחירה במחצית א׳" /></label></div><button className="primary-action" disabled={pending || readOnly}>יצירת התהליך והמשך להגדרות</button></form><p role="status">{message}</p></section>
  return <section className="workspace-card"><h2>עריכת תהליך הבחירה</h2>{confirmation}<p role="status">{message}</p>
    {locked && <p className="read-only-notice">לאחר פתיחת הבחירה אי אפשר לשנות מקבצים וקורסים. את מועד הסגירה אפשר לעדכן כל עוד הבחירה פתוחה.</p>}
    <nav className="role-navigation" aria-label="עריכת טופס"><button type="button" className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}>הגדרות הטופס והקורסים</button><button type="button" className={tab==='preview'?'active':''} onClick={()=>preview()} disabled={!loaded}>תצוגת תלמיד</button></nav>
    {!loaded ? <p>טוען את הטופס…</p> : <>
    {locked && design.documentUrl && <p><a href={design.documentUrl} target="_blank" rel="noopener noreferrer">פתיחת תקצירי הקורסים ↗</a></p>}
    {locked && design.documentStoragePath && <button type="button" className="secondary-action" onClick={() => void downloadCycleDocument(cycle.id).catch(()=>setMessage('פתיחת המסמך נכשלה. נסו שוב.'))}>הורדת תקצירי הקורסים</button>}
    <fieldset className="workspace-boundary" disabled={locked || pending}>
    {tab==='settings' && <div className="form-editor setup-grid"><h3 className="setup-section-title">פתיח ועיצוב הטופס</h3>
      <label>כותרת הטופס<input maxLength={150} value={design.title} onChange={e=>setDesign({...design,title:e.target.value})}/></label>
      <label>טקסט כפתור ההגשה<input maxLength={60} value={design.submitLabel} onChange={e=>setDesign({...design,submitLabel:e.target.value})}/></label>
      <label>פתיח<textarea rows={4} maxLength={4000} value={design.introduction} onChange={e=>setDesign({...design,introduction:e.target.value})}/></label>
      {design.introduction !== defaultFormDesign.introduction && <button type="button" className="secondary-action" onClick={()=>setDesign({...design,introduction:defaultFormDesign.introduction})}>החלת נוסח הפתיח המוצע</button>}
      <label>הוראות לבחירה<textarea rows={4} maxLength={2000} value={design.instructions} onChange={e=>setDesign({...design,instructions:e.target.value})}/></label>
      <p>מסמך תקצירי הקורסים: {design.documentName || (design.documentUrl ? 'Google Docs' : 'לא נוסף מסמך')}. אפשר להוסיף או להחליף אותו בהמשך ההגדרות.</p>
      <label className="setup-option"><input type="checkbox" checked={design.documentLinkVisible} onChange={e=>setDesign({...design,documentLinkVisible:e.target.checked})}/>הצגת הקישור לתלמידים בראש הטופס</label>
      <label>קישור לתמונת פתיחה<input type="url" value={design.coverUrl} onChange={e=>setDesign({...design,coverUrl:e.target.value})}/></label>
      <label>צבע מוביל<select value={design.theme} onChange={e=>setDesign({...design,theme:e.target.value as FormDesign['theme']})}><option value="blue">כחול</option><option value="teal">טורקיז</option><option value="purple">סגול</option></select></label>
      <label>תצוגת הקורסים<select value={design.layout} onChange={e=>setDesign({...design,layout:e.target.value as FormDesign['layout']})}><option value="cards">כרטיסים</option><option value="list">רשימה</option></select></label>
    </div>}
    <div hidden={tab!=='settings'}><h3 className="setup-section-title">מקבצים, קורסים ומורים</h3><CourseDescriptionImport
      cycleId={cycle.id}
      documentUrl={design.documentUrl}
      documentStoragePath={design.documentStoragePath}
      documentName={design.documentName}
      onSourceChange={source=>setDesign(current=>({...current,...source,documentLinkVisible:Boolean(source.documentUrl || source.documentStoragePath)}))}
      candidates={clusters.flatMap((cluster,ci)=>cluster.courses.map((course,ti)=>({
        id:`${ci}-${ti}`, clusterLabel:cluster.label||`מקבץ ${ci+1}`, label:course.label,
        instructorNames:course.instructorIds.map(id=>instructors.find(teacher=>teacher.uid===id)?.displayName??'').filter(Boolean), description:course.description,
      })))}
      onApply={values=>setClusters(current=>current.map((cluster,ci)=>({...cluster,courses:cluster.courses.map((course,ti)=>({
        ...course, description:values.find(value=>value.courseId===`${ci}-${ti}`)?.description??course.description,
      }))})))}
    />{clusters.map((cluster,ci)=><article className="setup-cluster" key={ci}>
      <div className="workspace-heading"><h3>מקבץ {ci+1}: {cluster.label}</h3><div className="workspace-actions"><button type="button" disabled={ci===0} onClick={()=>setClusters(move(clusters,ci,-1))}>הזזה למעלה</button><button type="button" disabled={ci===clusters.length-1} onClick={()=>setClusters(move(clusters,ci,1))}>הזזה למטה</button></div></div>
      <div className="setup-grid"><label>שם המקבץ<input value={cluster.label} onChange={e=>updateCluster(ci,{label:e.target.value})}/></label><label>מספר קורסים לדירוג<input type="number" min={minimumRankingCount(cluster.courses.length)} max={cluster.courses.length} value={cluster.requiredRankingCount} onChange={e=>updateCluster(ci,{requiredRankingCount:e.target.value})}/></label><label>הסבר לבחירה<select value={cluster.rationaleMode??'optional'} onChange={e=>updateCluster(ci,{rationaleMode:e.target.value as CatalogClusterDraft['rationaleMode']})}><option value="optional">שדה רשות</option><option value="required">שדה חובה</option><option value="hidden">ללא שדה הסבר</option></select></label><label>הוראות למקבץ<textarea value={cluster.description??''} onChange={e=>updateCluster(ci,{description:e.target.value})}/></label></div>
      <WeeklySlotFields value={cluster.weeklySlot} onChange={weeklySlot=>updateCluster(ci,{weeklySlot})}/>
      <fieldset className="teacher-picker"><legend>כיתות משתתפות</legend>
        <label><input type="checkbox" checked={cluster.eligibleClassIds===undefined} onChange={e=>updateCluster(ci,{eligibleClassIds:e.target.checked?undefined:[]})}/>כל הכיתות</label>
        {classes.map(schoolClass=><label key={schoolClass.id}><input type="checkbox" checked={cluster.eligibleClassIds===undefined || cluster.eligibleClassIds.includes(schoolClass.id)} onChange={e=>{const selected=cluster.eligibleClassIds??classes.map(c=>c.id);updateCluster(ci,{eligibleClassIds:e.target.checked?[...selected,schoolClass.id]:selected.filter(id=>id!==schoolClass.id)})}}/>{schoolClass.name}</label>)}
        {!classes.length && <p>לא נמצאו כיתות פעילות בבית הספר.</p>}
        {cluster.eligibleClassIds?.filter(id=>!classes.some(c=>c.id===id)).map(id=><label key={id}><input type="checkbox" checked onChange={()=>updateCluster(ci,{eligibleClassIds:cluster.eligibleClassIds?.filter(value=>value!==id)})}/>כיתה שאינה פעילה ({id})</label>)}
        {cluster.eligibleClassIds?.length===0 && <p role="alert">יש לבחור כיתה אחת לפחות או לבחור בכל הכיתות.</p>}
      </fieldset>
      <CapacityPlanner key={JSON.stringify([cluster.courses.map(c=>[c.label,c.capacityLimit,c.minimum,c.target,c.maximum]),cluster.capacityFlexibility])} students={roster===null?null:roster.filter(student=>includesClass(cluster,student.classId)).length} courses={cluster.courses} initialFlexibility={cluster.capacityFlexibility} onApply={(values,flexibility)=>updateCluster(ci,{capacityFlexibility:flexibility,courses:cluster.courses.map((course,i)=>{const next={...course,...values[i]};if(values[i].capacityLimit===undefined)delete next.capacityLimit;return next})})}/>
      <CourseTableImport instructors={instructors} clusterName={cluster.label} existingCourses={cluster.courses} onAdd={added=>updateCluster(ci,{courses:[...cluster.courses,...added]})}/>
      <label className="setup-option"><input type="checkbox" checked={cluster.balanceByClass} onChange={e=>updateCluster(ci,{balanceByClass:e.target.checked})}/>איזון לפי כיתת מקור</label>
      {cluster.courses.map((course,ti)=><section className="setup-course" key={ti}><h4>קורס {ti+1}</h4><div className="setup-grid">
        <label>שם הקורס<input value={course.label} onChange={e=>updateCourse(ci,ti,{label:e.target.value})}/></label>
        <label>תחום דעת<input value={course.subjectArea} onChange={e=>updateCourse(ci,ti,{subjectArea:e.target.value})}/></label>
        <label>תיאור הקורס<textarea rows={3} value={course.description} onChange={e=>updateCourse(ci,ti,{description:e.target.value})}/></label>
        <label>מסמך Google Docs עם תכני הקורס<input type="url" value={course.documentUrl??''} onChange={e=>updateCourse(ci,ti,{documentUrl:e.target.value})}/></label>
        <label>קישור לתמונת הקורס<input type="url" value={course.imageUrl??''} onChange={e=>updateCourse(ci,ti,{imageUrl:e.target.value})}/></label>
        <InstructorPicker instructors={instructors} selected={course.instructorIds} onChange={ids=>updateCourse(ci,ti,{instructorIds:ids})}/>
        <label>חזרה על הקורס<select value={course.repeatPolicy} onChange={e=>updateCourse(ci,ti,{repeatPolicy:e.target.value as CatalogCourseDraft['repeatPolicy']})}><option value="allowed">מותרת</option><option value="approval_required">דורשת אישור</option><option value="discouraged">לא מומלצת</option><option value="prohibited">אסורה</option></select></label>
      </div><div className="workspace-actions"><button type="button" disabled={ti===0} onClick={()=>updateCluster(ci,{courses:move(cluster.courses,ti,-1)})}>הזזת קורס למעלה</button><button type="button" disabled={ti===cluster.courses.length-1} onClick={()=>updateCluster(ci,{courses:move(cluster.courses,ti,1)})}>הזזת קורס למטה</button>{cluster.courses.length>1 && <button type="button" onClick={async()=>{if(await confirm('להסיר את הקורס?'))updateCluster(ci,{courses:cluster.courses.filter((_,i)=>i!==ti)})}}>הסרת קורס</button>}</div></section>)}
      <div className="workspace-actions"><button type="button" className="secondary-action" onClick={()=>updateCluster(ci,{courses:[...cluster.courses,emptyCourse()]})}>הוספת קורס</button>{clusters.length>1 && <button type="button" className="text-action" onClick={async()=>{if(await confirm('להסיר את המקבץ והקורסים שבתוכו?'))setClusters(clusters.filter((_,i)=>i!==ci))}}>הסרת מקבץ</button>}</div>
    </article>)}<button className="secondary-action" onClick={()=>setClusters([...clusters,emptyCluster()])}>הוספת מקבץ</button></div>
    {tab!=='preview' && !locked && <div className="editor-save"><button className="primary-action" type="button" disabled={pending} onClick={()=>void save()}>שמירת הטופס והקורסים</button><button className="secondary-action" type="button" disabled={pending} onClick={()=>void openChoice()}>שליחת טופס לתלמידים</button><span role="status">{message || (catalogSaved && signature===savedSignature && !deadlineDirty?'כל השינויים נשמרו':'יש שינויים שלא נשמרו')}</span></div>}
    </fieldset>
    {locked && !readOnly && tab==='settings' && <WeeklyScheduleEditor cycleId={cycle.id} />}
    {tab==='settings' && (cycle.status==='draft' || cycle.status==='choice_open') && <div className="deadline-settings"><label>מועד סגירת הטופס (רשות, שעון ישראל)<input type="datetime-local" value={deadlineInput} onChange={event=>setDeadlineInput(event.target.value)} disabled={!deadlineEditable || pending}/></label>{cycle.status==='choice_open' && <button type="button" className="secondary-action" disabled={!deadlineEditable || pending || !deadlineDirty} onClick={()=>void saveDeadline()}>שמירת מועד הסגירה</button>}{cycle.status==='draft' && <p>מועד הסגירה יישמר יחד עם הטופס והקורסים.</p>}{cycle.choiceDeadlineEnabled && cycle.choiceClosesAt && <p>המועד השמור: {formatIsraelDateTime(cycle.choiceClosesAt)}</p>}</div>}
    {tab==='preview' && <div><div className="setup-grid"><label>תצוגה לפי כיתה<select value={previewClass} onChange={e=>preview(e.target.value)}><option value="*">כל המקבצים</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="">ללא שיוך לכיתה</option></select></label></div>{!previewClusters.length && <p>אין מקבצים פתוחים לכיתה זו.</p>}<div className="workspace-actions"><button className="secondary-action" aria-pressed={device==='desktop'} onClick={()=>setDevice('desktop')}>מחשב</button><button className="secondary-action" aria-pressed={device==='mobile'} onClick={()=>setDevice('mobile')}>נייד</button></div><p>תצוגה מקדימה — ההתנסות אינה שומרת בחירות של תלמידים.</p><p role="status">{previewMessage}</p><div className={`student-preview ${device}`}>{previewClusters.length>0 && <ChoiceForm clusters={previewClusters} design={parseFormDesign(design)} preferences={previewPreferences} onChange={setPreviewPreferences} onOpenDocument={()=>void downloadCycleDocument(cycle.id,design.documentStoragePath).catch(()=>setPreviewMessage('פתיחת המסמך נכשלה. נסו שוב.'))} schoolName={schoolName} schoolLogo={schoolLogo} onSubmit={()=>setPreviewMessage('הטופס תקין ומוכן להגשה. לא נשלחה הגשה אמיתית.')} preview />}</div></div>}
    </>}
  </section>
}
