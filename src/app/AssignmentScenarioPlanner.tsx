import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssignmentParticipationScope, AssignmentRun, WorkflowState } from '../domain/workflow'
import type { StudentRosterEntry } from '../domain/studentRoster'
import { getStudentRoster, listAssignmentRuns, runAssignment, selectAssignmentRun } from './firebaseApi'

const emptyScope = ():AssignmentParticipationScope=>({excludedClassIdsByCluster:{},excludedStudentIdsByCluster:{}})
const copyScope = (scope?:AssignmentParticipationScope):AssignmentParticipationScope=>({
  excludedClassIdsByCluster:Object.fromEntries(Object.entries(scope?.excludedClassIdsByCluster??{}).map(([key,ids])=>[key,[...ids]])),
  excludedStudentIdsByCluster:Object.fromEntries(Object.entries(scope?.excludedStudentIdsByCluster??{}).map(([key,ids])=>[key,[...ids]])),
})

function toggleId(source:Record<string,string[]>,clusterId:string,id:string,include:boolean):Record<string,string[]> {
  const values=new Set(source[clusterId]??[])
  if(include) values.delete(id); else values.add(id)
  const next={...source}
  if(values.size)next[clusterId]=[...values];else delete next[clusterId]
  return next
}

export function AssignmentScenarioPlanner({cycleId,workflow,clusterLabels,readOnly,onWorkflow}: {
  cycleId:string;workflow:WorkflowState;clusterLabels:Record<string,string>;readOnly:boolean;onWorkflow:(workflow:WorkflowState)=>void
}) {
  const [students,setStudents]=useState<StudentRosterEntry[]>([]),[runs,setRuns]=useState<AssignmentRun[]>([])
  const [scope,setScope]=useState<AssignmentParticipationScope>(emptyScope),[label,setLabel]=useState('הרצה 1 — כל המשתתפים')
  const [query,setQuery]=useState(''),[message,setMessage]=useState('טוען את אוכלוסיית השיבוץ…'),[pending,setPending]=useState(false)
  const loadedRunId=useRef('')
  const clusterIds=Object.keys(clusterLabels)
  useEffect(()=>{let active=true;void Promise.all([getStudentRoster(cycleId),listAssignmentRuns(cycleId)]).then(([roster,history])=>{if(!active)return;setStudents(roster.filter(student=>student.choices.length>0));setRuns(history);setMessage('')}).catch(()=>{if(active)setMessage('טעינת הרכב השיבוץ נכשלה. אפשר לרענן ולנסות שוב.')});return()=>{active=false}},[cycleId,workflow.version])
  useEffect(()=>{const run=workflow.assignmentRun;if(!run||loadedRunId.current===run.id)return;loadedRunId.current=run.id;setScope(copyScope(run.scope));setLabel(`${run.label??'הרצה'} — גרסה חדשה`)},[workflow.assignmentRun])
  const classes=useMemo(()=>[...new Map(students.filter(student=>student.classId).map(student=>[student.classId,student.classLabel||student.classId])).entries()],[students])
  const shown=students.filter(student=>!query.trim()||student.name.includes(query.trim())||student.classLabel.includes(query.trim())).slice(0,60)
  const applies=(student:StudentRosterEntry,clusterId:string)=>student.choices.some(choice=>choice.clusterId===clusterId)
  const classExcluded=(student:StudentRosterEntry,clusterId:string)=>Boolean(student.classId&&scope.excludedClassIdsByCluster[clusterId]?.includes(student.classId))
  const studentExcluded=(student:StudentRosterEntry,clusterId:string)=>classExcluded(student,clusterId)||Boolean(scope.excludedStudentIdsByCluster[clusterId]?.includes(student.id))
  const eligiblePairs=students.flatMap(student=>clusterIds.filter(clusterId=>applies(student,clusterId)).map(clusterId=>({student,clusterId})))
  const includedPairs=eligiblePairs.filter(({student,clusterId})=>!studentExcluded(student,clusterId)).length
  function toggleClass(classId:string,clusterId:string,include:boolean){setScope(value=>({...value,excludedClassIdsByCluster:toggleId(value.excludedClassIdsByCluster,clusterId,classId,include)}))}
  function toggleStudent(studentId:string,clusterId:string,include:boolean){setScope(value=>({...value,excludedStudentIdsByCluster:toggleId(value.excludedStudentIdsByCluster,clusterId,studentId,include)}))}
  function classApplies(classId:string,clusterId:string){return students.some(student=>student.classId===classId&&applies(student,clusterId))}
  function toggleClassEverywhere(classId:string,include:boolean){setScope(value=>({...value,excludedClassIdsByCluster:clusterIds.filter(clusterId=>classApplies(classId,clusterId)).reduce((result,clusterId)=>toggleId(result,clusterId,classId,include),value.excludedClassIdsByCluster)}))}
  function toggleStudentEverywhere(student:StudentRosterEntry,include:boolean){setScope(value=>({...value,excludedStudentIdsByCluster:clusterIds.filter(clusterId=>applies(student,clusterId)).reduce((result,clusterId)=>toggleId(result,clusterId,student.id,include),value.excludedStudentIdsByCluster)}))}
  async function createRun(){if(pending||readOnly||!label.trim()||!includedPairs)return;try{setPending(true);setMessage('יוצר שיבוץ מוצע חדש…');const updated=await runAssignment(cycleId,label.trim(),scope);onWorkflow(updated);setMessage('ההרצה נשמרה ונבחרה כהצעה הפעילה.')}catch(error){setMessage(error instanceof Error?error.message:'יצירת ההרצה נכשלה.')}finally{setPending(false)}}
  async function choose(run:AssignmentRun){if(pending||readOnly||run.rejectedAt)return;try{setPending(true);const updated=await selectAssignmentRun(cycleId,run.id);onWorkflow(updated);setMessage('ההרצה נבחרה כהצעה הפעילה.')}catch(error){setMessage(error instanceof Error?error.message:'בחירת ההרצה נכשלה.')}finally{setPending(false)}}
  function loadScope(run:AssignmentRun){setScope(copyScope(run.scope));setLabel(`${run.label??'הרצה'} — גרסה חדשה`);setMessage('הרכב ההרצה נטען. אפשר לשנות וליצור שיבוץ נוסף.')}
  return <div className="scenario-planner">
    <div className="section-heading compact"><div><h3>מי משתתף בשיבוץ</h3><p>השינויים חלים על ההרצה הבאה בלבד. הבחירות שכבר הוגשו נשמרות.</p></div><span className="status-pill">נכללים {includedPairs} מתוך {eligiblePairs.length}</span></div>
    {message&&<p role="status">{message}</p>}
    <label>שם ההרצה<input maxLength={120} value={label} onChange={event=>setLabel(event.target.value)} placeholder="לדוגמה: ללא כיתות ההדגמה" /></label>
    <div className="scenario-matrix table-scroll"><table><caption>כיתות משתתפות בכל מקבץ</caption><thead><tr><th>כיתת־אם</th>{clusterIds.map(id=><th key={id}>{clusterLabels[id]}</th>)}<th>כל המקבצים</th></tr></thead><tbody>{classes.map(([classId,classLabel])=>{const relevant=clusterIds.filter(clusterId=>classApplies(classId,clusterId));const excludedEverywhere=relevant.every(clusterId=>scope.excludedClassIdsByCluster[clusterId]?.includes(classId));return <tr key={classId}><th scope="row">{classLabel}</th>{clusterIds.map(clusterId=>{const isRelevant=classApplies(classId,clusterId);const included=!scope.excludedClassIdsByCluster[clusterId]?.includes(classId);return <td key={clusterId}>{isRelevant?<input type="checkbox" aria-label={`${classLabel} משתתפת ב${clusterLabels[clusterId]}`} checked={included} disabled={readOnly} onChange={event=>toggleClass(classId,clusterId,event.target.checked)}/>:<span aria-label="לא שייך למקבץ">—</span>}</td>})}<td><button type="button" className="text-action" disabled={readOnly} onClick={()=>toggleClassEverywhere(classId,excludedEverywhere)}>{excludedEverywhere?'החזרה':'החרגה'}</button></td></tr>})}</tbody></table></div>
    <details><summary>חריגות של תלמידים מסוימים</summary><label>חיפוש תלמיד<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="שם או כיתה" /></label><div className="scenario-matrix table-scroll"><table><caption>השתתפות תלמידים בכל מקבץ</caption><thead><tr><th>תלמיד</th><th>כיתה</th>{clusterIds.map(id=><th key={id}>{clusterLabels[id]}</th>)}<th>כל המקבצים</th></tr></thead><tbody>{shown.map(student=>{const relevant=clusterIds.filter(clusterId=>applies(student,clusterId));const excludedEverywhere=relevant.every(clusterId=>studentExcluded(student,clusterId));return <tr key={student.id}><th scope="row">{student.name}</th><td>{student.classLabel}</td>{clusterIds.map(clusterId=>{if(!applies(student,clusterId))return <td key={clusterId}>—</td>;const blockedByClass=classExcluded(student,clusterId);return <td key={clusterId}><input type="checkbox" aria-label={`${student.name} משתתף ב${clusterLabels[clusterId]}`} checked={!studentExcluded(student,clusterId)} disabled={readOnly||blockedByClass} title={blockedByClass?'הכיתה כולה מוחרגת במקבץ זה':''} onChange={event=>toggleStudent(student.id,clusterId,event.target.checked)}/></td>})}<td><button type="button" className="text-action" disabled={readOnly||relevant.every(clusterId=>classExcluded(student,clusterId))} onClick={()=>toggleStudentEverywhere(student,excludedEverywhere)}>{excludedEverywhere?'החזרה':'החרגה'}</button></td></tr>})}</tbody></table></div>{students.length>60&&!query&&<p>מוצגים 60 תלמידים. השתמשו בחיפוש כדי להגיע לתלמיד נוסף.</p>}</details>
    <div className="workspace-actions"><button type="button" className="primary-action" disabled={readOnly||pending||!label.trim()||!includedPairs} onClick={()=>void createRun()}>יצירת שיבוץ מוצע חדש</button><button type="button" className="secondary-action" disabled={readOnly||pending} onClick={()=>{setScope(emptyScope());setLabel(`הרצה ${runs.length+1} — כל המשתתפים`)}}>החזרת כל המשתתפים</button></div>
    {runs.length>0&&<div className="scenario-history"><h4>{runs.length===20?'20 ההרצות האחרונות':'השוואת הרצות'}</h4><div className="table-scroll"><table><thead><tr><th>הרצה</th><th>תלמידים ששובצו</th><th>בחירה ראשונה</th><th>החרגות ממקבצים</th><th>אזהרות</th><th>פעולות</th></tr></thead><tbody>{runs.map(run=>{const active=workflow.assignmentRun?.id===run.id;return <tr key={run.id}><th scope="row">{run.label??'הרצת שיבוץ'}<small>{new Date(run.executedAt).toLocaleString('he-IL')}</small>{active&&<span className="status-pill">פעילה</span>}{run.approvedAt&&<span className="status-pill">אושרה</span>}{run.rejectedAt&&<span className="status-pill">נדחתה</span>}</th><td>{new Set(run.assignments.map(entry=>entry.studentId)).size}</td><td>{run.assignments.filter(entry=>entry.rank===1).length}/{run.assignments.length}</td><td>{run.excludedStudentClusterCount??0}</td><td>{run.warnings.length}</td><td><div className="workspace-actions"><button type="button" className="text-action" onClick={()=>loadScope(run)}>טעינת הרכב</button><button type="button" className="secondary-action" disabled={readOnly||pending||active||Boolean(run.rejectedAt)} onClick={()=>void choose(run)}>בחירת הרצה</button></div></td></tr>})}</tbody></table></div></div>}
  </div>
}
