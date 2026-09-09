import { createHash } from 'node:crypto'
import { HttpsError,onCall } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import type { WorkflowState } from '../../src/domain/workflow'
import type { Course, CycleCatalogSnapshot } from '../../src/domain/catalog'
import { renderMail, canonicalEmail, recipientAllowed, type MailJob } from '../../server/mail/delivery'
import { cycleDocumentPath, workflowDocumentPath, courseCatalogDocumentPath, catalogSnapshotDocumentPath } from '../../server/firestore/paths'
import { actorFromRequest, inputRecord, requiredString } from './request'
import { callableOptions, coreFirestore, nativFirestore as db } from './firebase'

const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
async function prepare(request: Parameters<typeof actorFromRequest>[0], write=false) {
  const actor=await actorFromRequest(request,write?'write':'read')
  if(!actor.capabilities.includes('nativ.assignment.publish'))throw new HttpsError('permission-denied','אין הרשאת שליחת תוצאות')
  const data=inputRecord(request.data),cycleId=requiredString(data,'cycleId'),audience=requiredString(data,'audience')
  if(!['student','staff'].includes(audience))throw new HttpsError('invalid-argument','יש לבחור צוות או תלמידים')
  const [workflowDoc,cycleDoc,catalogDoc,coursesDoc]=await Promise.all([db.doc(workflowDocumentPath(actor.organizationId,cycleId)).get(),db.doc(cycleDocumentPath(actor.organizationId,cycleId)).get(),db.doc(catalogSnapshotDocumentPath(actor.organizationId,cycleId)).get(),db.doc(courseCatalogDocumentPath(actor.organizationId,cycleId)).get()])
  const workflow=workflowDoc.data() as WorkflowState | undefined
  if(!workflow?.assignmentRun?.publishedAt || !['published','appeals','closed'].includes(cycleDoc.data()?.status))throw new HttpsError('failed-precondition','יש לאשר ולפרסם את השיבוץ במערכת לפני השליחה')
  const courses=(coursesDoc.data()?.courses??[]) as Course[],catalog=catalogDoc.data() as CycleCatalogSnapshot
  const signature=hash(JSON.stringify(workflow.assignmentRun.assignments.map(a=>[a.studentId,a.clusterId,a.courseId]).sort()))
  const dispatchId=audience+'-'+signature
  const dispatchRef=db.doc(`organizations/${actor.organizationId}/resultDispatches/${cycleId}-${dispatchId}`)
  const members=new Map<string,Record<string,unknown>>(),access=new Map<string,Record<string,unknown>>()
  if(process.env.FUNCTIONS_EMULATOR==='true'){
    const users=await getAuth().listUsers(1000)
    for(const u of users.users.filter(u=>u.customClaims?.organizationId===actor.organizationId)){members.set(u.uid,{active:u.customClaims?.active===true,role:u.customClaims?.roles?.includes('student')?'student':'teacher',fullName:u.displayName||u.email,email:u.email});access.set(u.uid,{active:true,roles:u.customClaims?.roles??[]})}
  }else{
    const [m,a]=await Promise.all([coreFirestore.collection(`organizations/${actor.organizationId}/members`).get(),db.collection(`organizations/${actor.organizationId}/accessAssignments`).get()]);m.docs.forEach(d=>members.set(d.id,d.data()));a.docs.forEach(d=>access.set(d.id,d.data()))
  }
  const individualJobs:MailJob[]=[],recipients=new Map<string,{name:string;email:string}>()
  let skipped=0
  const now=new Date().toISOString()
  for(const assignment of workflow.assignmentRun.assignments){
    const course=courses.find(c=>c.id===assignment.courseId),cluster=catalog?.clusters.find(c=>c.clusterId===assignment.clusterId)
    if(!course || !cluster)throw new HttpsError('failed-precondition','חסרים פרטי קורס')
    const candidates=audience==='student'?[assignment.studentId]:[...access.keys()].filter(uid=>{const roles=access.get(uid)?.roles as string[];return roles?.some(role=>['secretary','placement_coordinator'].includes(role)) || (roles?.includes('course_instructor') && course.instructorIds.includes(uid))})
    for(const uid of candidates){const member=members.get(uid),email=canonicalEmail(member?.primaryEmail)??canonicalEmail(member?.email)
      if(!email || !recipientAllowed(audience as MailJob['audience'],member,access.get(uid))){skipped++;continue}
      const job:MailJob={notificationId:hash(dispatchId+':'+uid+':'+assignment.studentId+':'+assignment.clusterId),audience:audience as 'student'|'staff',recipientId:uid,studentId:assignment.studentId,courseId:course.id,clusterLabel:cluster.label,afterCourseLabel:course.label,occurredAt:now}
      job.results=[{studentId:assignment.studentId,name:assignment.studentLabel??String(members.get(assignment.studentId)?.fullName??'תלמיד'),classLabel:assignment.studentClassLabel??'',clusterLabel:cluster.label,courseLabel:course.label,courseId:course.id}];individualJobs.push(job);recipients.set(uid,{name:String(member?.fullName??'נמען'),email})
    }
  }
  const grouped=new Map<string,MailJob>()
  for(const job of individualJobs){const uid=job.recipientId!;const existing=grouped.get(uid);if(existing)existing.results!.push(...job.results!);else grouped.set(uid,{...job,notificationId:hash(dispatchId+':'+uid),results:[...job.results!]})}
  const jobs=[...grouped.values()]
  if(jobs.some(job=>Buffer.byteLength(JSON.stringify(job))>650000))throw new HttpsError('failed-precondition','הדוח גדול מדי לשליחה. פנו למנהל המערכת.')
  const messages=jobs.map(job=>({...recipients.get(job.recipientId!)!,...renderMail(job,{name:'',classLabel:''})}))
  if(jobs.length>3000)throw new HttpsError('failed-precondition','רשימת השליחה גדולה מדי. פנו למנהל המערכת לפני שליחה.')
  const recipientSignature=hash(JSON.stringify(messages.map((m,i)=>[jobs[i].recipientId,jobs[i].studentId,jobs[i].courseId,m.email,m.subject,m.text]).sort()))
  const dispatch=await dispatchRef.get()
  return {actor,cycleId,audience,workflow,signature,recipientSignature,dispatchId,dispatchRef,dispatch,jobs,messages,skipped,now}
}
export const previewResultDelivery=onCall(callableOptions,async request=>{
  const p=await prepare(request)
  const events=p.dispatch.data()?.eventIds as string[]|undefined
  const statuses=events?.length?await db.getAll(...events.map(id=>db.doc(`organizations/${p.actor.organizationId}/mailEvents/${id}`))):[]
  const deliveries=p.dispatch.data()?.notificationIds as string[]|undefined
  let sent=0,failed=0,unknown=0
  for(let i=0;i<(deliveries?.length??0);i+=100){const rows=await db.getAll(...deliveries!.slice(i,i+100).map(id=>db.doc(`organizations/${p.actor.organizationId}/mailStatuses/${id}`)));for(const row of rows){if(row.data()?.status==='sent')sent++;if(row.data()?.status==='failed')failed++;if(row.data()?.status==='delivery_unknown')unknown++}}
  return {signature:p.signature,recipientSignature:p.recipientSignature,version:p.workflow.version,messages:p.messages,skipped:p.skipped,alreadyQueued:p.dispatch.exists,status:p.dispatch.exists?{sent,failed,unknown,queued:Math.max(0,(deliveries?.length??0)-sent-failed-unknown),failedBatches:statuses.filter(s=>s.data()?.status==='failed').length}:null}
})
export const sendResultDelivery=onCall(callableOptions,async request=>{
  const p=await prepare(request,true),data=inputRecord(request.data)
  if(data.signature!==p.signature || data.recipientSignature!==p.recipientSignature || data.expectedVersion!==p.workflow.version)throw new HttpsError('aborted','השיבוץ או הנמענים השתנו. יש לפתוח תצוגה מקדימה חדשה.')
  if(!p.jobs.length)throw new HttpsError('failed-precondition','אין נמענים פעילים עם כתובת דואר תקינה')
  return db.runTransaction(async tx=>{
    const [existing,workflow]=await tx.getAll(p.dispatchRef,db.doc(workflowDocumentPath(p.actor.organizationId,p.cycleId)))
    if(existing.exists)return {alreadyQueued:true}
    if(workflow.data()?.version!==p.workflow.version)throw new HttpsError('aborted','השיבוץ השתנה. יש לבדוק מחדש לפני השליחה.')
    const eventIds:string[]=[]
    const batches:MailJob[][]=[];let batch:MailJob[]=[];let bytes=0
    for(const job of p.jobs){const size=Buffer.byteLength(JSON.stringify(job));if(batch.length && (batch.length>=100 || bytes+size>700000)){batches.push(batch);batch=[];bytes=0}batch.push(job);bytes+=size}if(batch.length)batches.push(batch)
    if(batches.length>450)throw new HttpsError('failed-precondition','המשלוח גדול מדי. פנו למנהל המערכת.')
    for(const [i,jobs] of batches.entries()){const id=p.cycleId+'-'+p.dispatchId+'-'+i;eventIds.push(id);tx.create(db.doc(`organizations/${p.actor.organizationId}/mailEvents/${id}`),{organizationId:p.actor.organizationId,cycleId:p.cycleId,jobs,status:'queued',attempts:0,createdAt:p.now,createdBy:p.actor.uid})}
    tx.create(p.dispatchRef,{signature:p.signature,audience:p.audience,eventIds,notificationIds:p.jobs.map(j=>j.notificationId),createdAt:p.now,createdBy:p.actor.uid})
    tx.create(db.collection(`organizations/${p.actor.organizationId}/nativAuditEvents`).doc(),{organizationId:p.actor.organizationId,actorId:p.actor.uid,action:'results.sent.'+p.audience,entityType:'AssignmentCycle',entityId:p.cycleId,occurredAt:p.now,reason:'שליחה מפורשת של '+p.jobs.length+' הודעות לאחר תצוגה מקדימה'})
    return {alreadyQueued:false}
  })
})
