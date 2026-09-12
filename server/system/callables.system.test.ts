import { currentSchoolYearStart, schoolYearId } from '../../src/domain/schoolYear'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import type { ChoiceContext } from '../../src/application/NativCommandService'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth'
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import type { WorkflowState } from '../../src/domain/workflow'
import { demoCatalogSnapshot, demoCourses, demoCycle, demoSubmission } from '../../src/demo/demoCycle'
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'

interface SeedResult {
  cycleId: string
  accounts: Array<{ label: string; email: string; password: string }>
}

describe('Nativ callable system flow', () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required')
  let app: FirebaseApp
  let auth: Auth
  let functions: Functions
  let accounts: SeedResult['accounts']
  const adminApp = initializeAdminApp({ projectId: 'demo-nativ-local' }, 'mail-system-test')
  const mailEvents = () => getFirestore(adminApp).collection(`organizations/${demoCycle.organizationId}/mailEvents`).get()

  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-nativ-local', apiKey: 'demo-api-key' }, 'nativ-system-test')
    auth = getAuth(app)
    functions = getFunctions(app, 'europe-west1')
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
    const seed = httpsCallable<undefined, SeedResult>(functions, 'seedDemoEnvironment')
    accounts = (await seed()).data.accounts
  })

  afterAll(async () => {
    if (auth) await signOut(auth)
    if (app) await deleteApp(app)
    await deleteAdminApp(adminApp)
  })

  it('authenticates a coordinator and resolves the organization context', async () => {
    const coordinator = accounts.find((account) => account.label === 'רכז שיבוץ')
    if (!coordinator) throw new Error('חשבון הרכז לא נוצר')
    await signInWithEmailAndPassword(auth, coordinator.email, coordinator.password)

    const status = httpsCallable<undefined, { status: string; liveDataConnected: boolean }>(functions, 'getPreparationStatus')
    await expect(status()).resolves.toMatchObject({ data: { status: 'local_mvp', liveDataConnected: false } })

    const getCycle = httpsCallable<{ cycleId: string }, AssignmentCycle>(functions, 'getCycle')
    const cycle = (await getCycle({ cycleId: demoCycle.id })).data
    expect(cycle).toMatchObject({ id: demoCycle.id, status: 'choice_open', version: 1 })
    const roster = httpsCallable<{ cycleId: string }, Array<{ id: string; classLabel: string; status: string }>>(functions, 'getStudentRoster')
    const students = (await roster({ cycleId: demoCycle.id })).data
    expect(students).toContainEqual(expect.objectContaining({ id: 'student-demo-001', classLabel: 'ז׳1', status: 'not_submitted' }))
  })

  it('authenticates a student, saves a canonical draft, submits it, and blocks management', async () => {
    const student = accounts.find((account) => account.label === 'תלמיד')
    if (!student) throw new Error('חשבון התלמיד לא נוצר')
    await signOut(auth)
    await signInWithEmailAndPassword(auth, student.email, student.password)

    const saveDraft = httpsCallable<Record<string, unknown>, PreferenceSubmission>(functions, 'savePreferenceDraft')
    const draft = (await saveDraft({
      cycleId: demoCycle.id,
      preferences: demoSubmission.preferences,
      expectedVersion: 0,
      idempotencyKey: 'system-save-draft',
    })).data
    expect(draft).toMatchObject({ studentId: 'student-demo-001', status: 'draft', version: 1 })
    expect(draft.catalogSnapshot).toHaveLength(2)

    const submit = httpsCallable<Record<string, unknown>, PreferenceSubmission>(functions, 'submitPreferences')
    const submitted = (await submit({
      cycleId: demoCycle.id,
      expectedDraftVersion: draft.version,
      submissionVersion: 1,
      idempotencyKey: 'system-submit-preferences',
    })).data
    expect(submitted).toMatchObject({ studentId: 'student-demo-001', status: 'submitted', submissionVersion: 1 })

    const transition = httpsCallable<Record<string, unknown>, AssignmentCycle>(functions, 'transitionCycle')
    await expect(transition({
      cycleId: demoCycle.id,
      expectedVersion: 2,
      to: 'assignment',
      reason: 'אסור לתלמיד',
      idempotencyKey: 'student-transition-blocked',
    })).rejects.toMatchObject({ code: 'functions/permission-denied' })
    const extractDescriptions = httpsCallable<Record<string, unknown>, unknown>(functions, 'extractCourseDescriptions')
    await expect(extractDescriptions({ kind:'docx',fileName:'courses.docx',base64:'AA==',candidates:[{id:'0-0',label:'קורס',instructorNames:[]}] })).rejects.toMatchObject({ code:'functions/permission-denied' })
    await expect(httpsCallable<Record<string,unknown>,unknown>(functions,'setChoiceDeadline')({cycleId:demoCycle.id,expectedVersion:1,choiceClosesAt:new Date(Date.now()+60000).toISOString()})).rejects.toMatchObject({code:'functions/permission-denied'})
    await expect(httpsCallable<Record<string,unknown>,unknown>(functions,'uploadCycleDocument')({cycleId:demoCycle.id,fileName:'courses.docx',base64:'UEs='})).rejects.toMatchObject({code:'functions/permission-denied'})
    const listRuns = httpsCallable<{cycleId:string},unknown[]>(functions,'listAssignmentRuns')
    await expect(listRuns({cycleId:demoCycle.id})).rejects.toMatchObject({code:'functions/permission-denied'})

    await signOut(auth)
    const coordinator = accounts.find((account) => account.label === 'רכז שיבוץ')
    if (!coordinator) throw new Error('חשבון הרכז לא נוצר')
    await signInWithEmailAndPassword(auth, coordinator.email, coordinator.password)
    const updated = (await transition({
      cycleId: demoCycle.id,
      expectedVersion: 1,
      to: 'choice_closed',
      reason: 'בדיקת מערכת מקומית',
      idempotencyKey: 'system-close-cycle',
    })).data
    expect(updated).toMatchObject({ status: 'choice_closed', version: 2 })
  })

  it('runs anonymous AI review, deterministic placement, publication, and a two-step appeal change', async () => {
    const generate = httpsCallable<{ cycleId: string }, WorkflowState>(functions, 'generateAiEvaluations')
    let workflow = (await generate({ cycleId: demoCycle.id })).data
    const repeated = (await generate({ cycleId: demoCycle.id })).data
    expect(repeated.aiEvaluations.map((entry) => entry.id)).toEqual(workflow.aiEvaluations.map((entry) => entry.id))
    expect(workflow.aiEvaluations).toHaveLength(2)
    expect(workflow.aiEvaluations.every((entry) => entry.anonymousStudentRef.startsWith('anon-'))).toBe(true)

    const approve = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'approveAiEvaluation')
    for (const evaluation of workflow.aiEvaluations) {
      workflow = (await approve({ cycleId: demoCycle.id, evaluationId: evaluation.id, priority: evaluation.raw.priority, summary: evaluation.raw.summary, reason: 'אישור בדיקת מערכת' })).data
    }
    expect(workflow.aiEvaluations.every((entry) => entry.approved)).toBe(true)

    const transition = httpsCallable<Record<string, unknown>, AssignmentCycle>(functions, 'transitionCycle')
    await transition({ cycleId: demoCycle.id, expectedVersion: 2, to: 'assignment', reason: 'כל ההערכות אושרו', idempotencyKey: 'system-start-assignment' })
    const run = httpsCallable<Record<string,unknown>, WorkflowState>(functions, 'runAssignment')
    workflow = (await run({ cycleId: demoCycle.id,label:'הרצה מלאה' })).data
    expect(workflow.assignmentRun?.assignments).toHaveLength(2)
    expect(workflow.assignmentRun).toMatchObject({ algorithmVersion: 'legacy-compatible-1.0.0', seed: 42 })
    const baselineRunId=workflow.assignmentRun!.id
    workflow=(await run({cycleId:demoCycle.id,label:'ללא אמנויות לתלמיד ההדגמה',scope:{excludedClassIdsByCluster:{},excludedStudentIdsByCluster:{'cluster-arts':['student-demo-001']}}})).data
    expect(workflow.assignmentRun).toMatchObject({label:'ללא אמנויות לתלמיד ההדגמה',excludedStudentClusterCount:1})
    expect(workflow.assignmentRun?.assignments).toHaveLength(1)
    const rejectRun=httpsCallable<Record<string,unknown>,WorkflowState>(functions,'rejectAssignmentRun')
    await expect(rejectRun({cycleId:demoCycle.id,expectedVersion:0,reason:'בדיקה'})).rejects.toMatchObject({code:'functions/aborted'})
    workflow=(await rejectRun({cycleId:demoCycle.id,expectedVersion:workflow.version,reason:'בחינה מחדש לפני פרסום'})).data
    expect(workflow.assignmentRun).toBeUndefined()
    const listRuns=httpsCallable<{cycleId:string},import('../../src/domain/workflow').AssignmentRun[]>(functions,'listAssignmentRuns')
    const savedRuns=(await listRuns({cycleId:demoCycle.id})).data
    expect(savedRuns).toHaveLength(2)
    expect(savedRuns.find(entry=>entry.label==='ללא אמנויות לתלמיד ההדגמה')?.rejectedAt).toBeTruthy()
    const selectRun=httpsCallable<{cycleId:string;runId:string},WorkflowState>(functions,'selectAssignmentRun')
    workflow=(await selectRun({cycleId:demoCycle.id,runId:baselineRunId})).data
    expect(workflow.assignmentRun?.assignments).toHaveLength(2)
    await expect(transition({ cycleId: demoCycle.id, expectedVersion: 3, to: 'published', reason: 'ניסיון לעקוף אישור', idempotencyKey: 'system-publish-bypass-blocked' })).rejects.toMatchObject({ code: 'functions/failed-precondition' })

    await signOut(auth)
    const studentBeforePublication = accounts.find((account) => account.label === 'תלמיד')!
    await signInWithEmailAndPassword(auth, studentBeforePublication.email, studentBeforePublication.password)
    const getStudentWorkflow = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'getWorkflow')
    const hiddenResult = (await getStudentWorkflow({ cycleId: demoCycle.id, view: 'student' })).data
    expect(hiddenResult.assignmentRun).toBeFalsy()
    await signOut(auth)
    const coordinatorBeforePublication = accounts.find((account) => account.label === 'רכז שיבוץ')!
    await signInWithEmailAndPassword(auth, coordinatorBeforePublication.email, coordinatorBeforePublication.password)

    const approveRun = httpsCallable<{ cycleId: string }, WorkflowState>(functions, 'approveAssignmentRun')
    workflow = (await approveRun({ cycleId: demoCycle.id })).data
    expect(workflow.assignmentRun?.approvedAt).toBeTruthy()
    expect(workflow.assignmentRun?.publishedAt).toBeUndefined()
    const publish = httpsCallable<{ cycleId: string }, WorkflowState>(functions, 'publishAssignments')
    workflow = (await publish({ cycleId: demoCycle.id })).data
    expect(workflow.assignmentRun?.publishedAt).toBeTruthy()
    expect(workflow.notifications).toHaveLength(2)
    expect((await mailEvents()).size).toBe(0)
    const previewSend=httpsCallable<Record<string,unknown>,{signature:string;recipientSignature:string;version:number;messages:Array<{email:string}>}>(functions,'previewResultDelivery')
    const sendResults=httpsCallable<Record<string,unknown>,unknown>(functions,'sendResultDelivery')
    const studentPreview=(await previewSend({cycleId:demoCycle.id,audience:'student'})).data
    expect(studentPreview.messages).toHaveLength(1)
    expect(studentPreview.messages.every(m=>m.email==='student@nativ.demo')).toBe(true)
    await expect(sendResults({cycleId:demoCycle.id,audience:'student',signature:'stale',recipientSignature:studentPreview.recipientSignature,expectedVersion:studentPreview.version})).rejects.toMatchObject({code:'functions/aborted'})
    await sendResults({cycleId:demoCycle.id,audience:'student',signature:studentPreview.signature,recipientSignature:studentPreview.recipientSignature,expectedVersion:studentPreview.version})
    await sendResults({cycleId:demoCycle.id,audience:'student',signature:studentPreview.signature,recipientSignature:studentPreview.recipientSignature,expectedVersion:studentPreview.version})
    const publicationEvents = await mailEvents()
    expect(publicationEvents.size).toBe(1)
    expect(publicationEvents.docs[0].data().jobs).toHaveLength(1)
    expect(publicationEvents.docs[0].data().jobs[0].results).toHaveLength(2)
    expect(JSON.stringify(publicationEvents.docs[0].data())).not.toMatch(/rationale|originalSubmission|aiEvaluation|explanation/)
    await expect(publish({ cycleId: demoCycle.id })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    expect((await mailEvents()).size).toBe(1)
    await transition({ cycleId: demoCycle.id, expectedVersion: 4, to: 'appeals', reason: 'פתיחת ערעורים בבדיקת מערכת', idempotencyKey: 'system-open-appeals' })

    await signOut(auth)
    const student = accounts.find((account) => account.label === 'תלמיד')!
    await signInWithEmailAndPassword(auth, student.email, student.password)
    const publishedStudentWorkflow=(await getStudentWorkflow({cycleId:demoCycle.id,view:'student'})).data
    expect(publishedStudentWorkflow.assignmentRun?.scope).toBeUndefined()
    expect(publishedStudentWorkflow.assignmentRun?.label).toBeUndefined()
    const current = workflow.assignmentRun!.assignments.find((entry) => entry.clusterId === 'cluster-arts')!
    const requestedCourseId = current.courseId === 'course-theater' ? 'course-music' : 'course-theater'
    const submitAppeal = httpsCallable<Record<string, unknown>, { id: string }>(functions, 'submitAppeal')
    await expect(submitAppeal({ cycleId: demoCycle.id, clusterId: 'cluster-arts', requestedCourseId: 'course-robotics', reason: 'קורס ממקבץ אחר' })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    const appeal = (await submitAppeal({ cycleId: demoCycle.id, clusterId: 'cluster-arts', requestedCourseId, reason: 'בקשת בדיקת מערכת' })).data

    await signOut(auth)
    const coordinator = accounts.find((account) => account.label === 'רכז שיבוץ')!
    await signInWithEmailAndPassword(auth, coordinator.email, coordinator.password)
    const analyze = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'analyzeAppeal')
    workflow = (await analyze({ cycleId: demoCycle.id, appealId: appeal.id })).data
    const analyzed = workflow.appeals.find((entry) => entry.id === appeal.id)!
    expect(analyzed.analysis).toMatchObject({ beforeCourseId: current.courseId, afterCourseId: requestedCourseId, requiresMovingAnotherStudent: false })
    expect(analyzed.originalSubmission?.preferences).toHaveLength(2)
    expect(analyzed.originalSubmission?.catalogSnapshot).toHaveLength(2)

    const recommend = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'recommendAppeal')
    workflow = (await recommend({ cycleId: demoCycle.id, appealId: appeal.id, outcome: 'approve', reason: 'המלצת צוות מנומקת' })).data
    expect(workflow.appeals.find((entry) => entry.id === appeal.id)?.recommendation?.outcome).toBe('approve')

    const decide = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'decideAppeal')
    workflow = (await decide({ cycleId: demoCycle.id, appealId: appeal.id, outcome: 'approved', reason: 'אפשרי לאחר ניתוח' })).data
    expect(workflow.assignmentRun!.assignments.find((entry) => entry.studentId === 'student-demo-001' && entry.clusterId === 'cluster-arts')!.courseId).toBe(current.courseId)
    expect(workflow.appeals.find((entry) => entry.id === appeal.id)?.status).toBe('approved_pending_execution')
    expect((await mailEvents()).size).toBe(1)

    const execute = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'executeAppealChange')
    workflow = (await execute({ cycleId: demoCycle.id, appealId: appeal.id, expectedWorkflowVersion: workflow.version })).data
    expect(workflow.assignmentRun!.assignments.find((entry) => entry.studentId === 'student-demo-001' && entry.clusterId === 'cluster-arts')!.courseId).toBe(requestedCourseId)
    expect(workflow.appeals.find((entry) => entry.id === appeal.id)?.status).toBe('executed')
    expect(workflow.notifications.filter((entry) => entry.audience === 'secretary')).toHaveLength(1)
    expect(workflow.notifications.filter((entry) => entry.audience === 'student' && entry.channel === 'email')).toHaveLength(0)
    expect((await mailEvents()).size).toBe(1)
    const staffPreview=(await previewSend({cycleId:demoCycle.id,audience:'staff'})).data
    expect(staffPreview.messages.length).toBeGreaterThan(0)
    expect(staffPreview.messages.every(m=>m.email!=='student@nativ.demo')).toBe(true)
    await sendResults({cycleId:demoCycle.id,audience:'staff',signature:staffPreview.signature,recipientSignature:staffPreview.recipientSignature,expectedVersion:staffPreview.version})
    expect((await mailEvents()).size).toBe(2)
    const change=(await mailEvents()).docs.find(doc=>doc.data().jobs[0].audience==='staff')!.data()
    expect(JSON.stringify(change)).not.toMatch(/rationale|originalSubmission|aiEvaluation|reason|analysis/)
    await expect(execute({cycleId:demoCycle.id,appealId:appeal.id,expectedWorkflowVersion:workflow.version})).rejects.toMatchObject({code:'functions/failed-precondition'})
    await signOut(auth);await signInWithEmailAndPassword(auth,student.email,student.password)
    await expect(previewSend({cycleId:demoCycle.id,audience:'staff'})).rejects.toMatchObject({code:'functions/permission-denied'})

  })

  it('keeps access management separate from professional data and supports multiple role holders', async () => {
    await signOut(auth)
    const manager = accounts.find((account) => account.label === 'מנהל גישה')!
    await signInWithEmailAndPassword(auth, manager.email, manager.password)
    const listUsers = httpsCallable<undefined, Array<{ uid: string; email?: string; roles: string[] }>>(functions, 'listAccessUsers')
    const users = (await listUsers()).data
    expect(users.length).toBeGreaterThanOrEqual(5)
    const getWorkflow = httpsCallable<{ cycleId: string }, WorkflowState>(functions, 'getWorkflow')
    await expect(getWorkflow({ cycleId: demoCycle.id })).rejects.toMatchObject({ code: 'functions/permission-denied' })

    const secretary = users.find((user) => user.email === 'secretary@nativ.demo')!
    const setAccess = httpsCallable<Record<string, unknown>, { roles: string[] }>(functions, 'setUserAccess')
    const ownUser = users.find((user) => user.email === 'access@nativ.demo')!
    await expect(setAccess({ uid: ownUser.uid, roles: ['access_manager'], active: false })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    const studentUser = users.find((user) => user.email === 'student@nativ.demo')!
    expect(studentUser).toBeTruthy()
    await expect(setAccess({ uid: studentUser.uid, roles: ['placement_coordinator'], active: true })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    const roster = httpsCallable<{ cycleId: string }, unknown[]>(functions, 'getStudentRoster')
    await expect(roster({ cycleId: demoCycle.id })).rejects.toMatchObject({ code: 'functions/permission-denied' })
    await expect(setAccess({ uid: ownUser.uid, roles: [], active: true })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    const updated = (await setAccess({ uid: secretary.uid, roles: ['secretary', 'placement_coordinator', 'access_manager'], active: true })).data
    expect(updated.roles).toEqual(['secretary', 'placement_coordinator', 'access_manager'])

    await signOut(auth)
    const secretaryAccount = accounts.find((account) => account.label === 'מזכירות')!
    await signInWithEmailAndPassword(auth, secretaryAccount.email, secretaryAccount.password)
    const combinedWorkflow = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'getWorkflow')
    expect((await combinedWorkflow({ cycleId: demoCycle.id, view: 'coordinator' })).data.assignmentRun).toBeTruthy()
    expect((await combinedWorkflow({ cycleId: demoCycle.id, view: 'secretary' })).data.assignmentRun).toBeFalsy()
  })

  it('creates a cycle and catalog and keeps an empty AI review retryable', async () => {
    await signOut(auth)
    const coordinator = accounts.find((account) => account.label === 'רכז שיבוץ')!
    await signInWithEmailAndPassword(auth, coordinator.email, coordinator.password)

    const createCycle = httpsCallable<Record<string, unknown>, AssignmentCycle>(functions, 'createCycle')
    const created = (await createCycle({ schoolYear: schoolYearId(currentSchoolYearStart()+1), termLabel: 'מחצית א׳' })).data
    expect(created).toMatchObject({ status: 'draft', version: 1 })
    const wordBase64=readFileSync(new URL('./fixtures/course-summaries.base64',import.meta.url),'utf8')
    const uploadWord=httpsCallable<Record<string,unknown>,{path:string;fileName:string}>(functions,'uploadCycleDocument')
    const uploaded=(await uploadWord({cycleId:created.id,fileName:'תקצירי הקורסים.docx',base64:wordBase64})).data
    expect(uploaded.path).toContain(`/${created.id}/source-documents/`)

    const listInstructors = httpsCallable<undefined, Array<{ uid: string; displayName: string }>>(functions, 'listEligibleInstructors')
    const instructors = (await listInstructors()).data
    expect(instructors.length).toBeGreaterThan(0)
    const instructorAccount=accounts.find(account=>account.label==='מנחה קורס')!
    const instructorUid=(await getAdminAuth(adminApp).getUserByEmail(instructorAccount.email)).uid
    expect(instructors.some(entry=>entry.uid===instructorUid)).toBe(true)

    const saveCatalog = httpsCallable<Record<string, unknown>, { id: string }>(functions, 'saveCycleCatalog')
    await saveCatalog({
      cycleId: created.id,
      expectedVersion:created.version,
      formDesign:{title:'בוחרים ביחד',theme:'teal',layout:'list',documentStoragePath:uploaded.path,documentName:uploaded.fileName,documentLinkVisible:true},
      clusters: [{
        label: 'אמנויות', capacityFlexibility: 4,
        description:'בחרו את הקורס המועדף',rationaleMode:'required',
        requiredRankingCount: 1,
        courses: [{
          label: 'תיאטרון',
          description: 'סדנת תיאטרון',documentUrl:'https://docs.google.com/document/d/test-document/edit',
          subjectArea: 'אמנויות',
          instructorIds: [instructorUid],
          minimum: 0,
          target: 18,
          maximum: 22, capacityLimit: 22,
          repeatPolicy: 'allowed',
        }],
      }],
    })

    const getCatalog = httpsCallable<{ cycleId: string }, { catalog: { clusters: unknown[] }; courses: unknown[] }>(functions, 'getCycleCatalog')
    const catalog = (await getCatalog({ cycleId: created.id })).data
    expect(catalog.catalog.clusters).toHaveLength(1)
    expect(catalog.catalog.clusters[0]).toMatchObject({ balanceByClass: false,rationaleMode:'required',description:'בחרו את הקורס המועדף' })
    expect(catalog.catalog).toMatchObject({formDesign:{title:'בוחרים ביחד',theme:'teal'}})
    const downloadWord=httpsCallable<Record<string,unknown>,{base64:string;fileName:string}>(functions,'downloadCycleDocument')
    expect((await downloadWord({cycleId:created.id})).data.base64).toBe(wordBase64)
    expect(catalog.courses).toHaveLength(1)
    expect(catalog.courses[0]).toMatchObject({capacity:{limit:22,maximum:22}})
    expect(catalog.catalog.clusters[0]).toMatchObject({capacityFlexibility:4})
    await expect(saveCatalog({cycleId:created.id,clusters:[{label:'x',requiredRankingCount:1,courses:[{label:'x',instructorIds:[instructors[0].uid],minimum:0,target:5,maximum:10,capacityLimit:8,repeatPolicy:'allowed'}]}]})).rejects.toMatchObject({code:'functions/invalid-argument'})

    const listCycles = httpsCallable<undefined, AssignmentCycle[]>(functions, 'listCycles')
    expect((await listCycles()).data.some((cycle) => cycle.id === created.id)).toBe(true)

    const getCycle = httpsCallable<{ cycleId: string }, AssignmentCycle>(functions, 'getCycle')
    const configured = (await getCycle({ cycleId: created.id })).data
    const transition = httpsCallable<Record<string, unknown>, AssignmentCycle>(functions, 'transitionCycle')
    await expect(saveCatalog({cycleId:created.id,expectedVersion:0,clusters:[{label:'x',requiredRankingCount:1,courses:[{label:'x',instructorIds:[instructors[0].uid],minimum:0,target:1,maximum:2,repeatPolicy:'allowed'}]}]})).rejects.toMatchObject({code:'functions/aborted'})
    const opened = (await transition({ cycleId: created.id, expectedVersion: configured.version, to: 'choice_open', reason: 'פתיחת בדיקת מערכת', idempotencyKey: 'system-open-new-cycle' })).data
    const setDeadline = httpsCallable<Record<string,unknown>, AssignmentCycle>(functions,'setChoiceDeadline')
    const firstDeadline = new Date(Date.now()+120000).toISOString()
    const timed = (await setDeadline({cycleId:created.id,expectedVersion:opened.version,choiceClosesAt:firstDeadline})).data
    expect(timed.choiceClosesAt).toBe(firstDeadline)
    expect(timed.choiceDeadlineEnabled).toBe(true)
    await expect(setDeadline({cycleId:created.id,expectedVersion:opened.version,choiceClosesAt:new Date(Date.now()+180000).toISOString()})).rejects.toMatchObject({code:'functions/aborted'})
    const extended = (await setDeadline({cycleId:created.id,expectedVersion:timed.version,choiceClosesAt:new Date(Date.now()+240000).toISOString()})).data
    expect(new Date(extended.choiceClosesAt!).getTime()).toBeGreaterThan(new Date(timed.choiceClosesAt!).getTime())
    await transition({ cycleId: created.id, expectedVersion: extended.version, to: 'choice_closed', reason: 'סיום בחירה ללא הגשות', idempotencyKey: 'system-close-empty-cycle' })

    const generate = httpsCallable<{ cycleId: string }, WorkflowState>(functions, 'generateAiEvaluations')
    await expect(generate({ cycleId: created.id })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    await expect(generate({ cycleId: created.id })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    const getWorkflow = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'getWorkflow')
    expect((await getWorkflow({ cycleId: created.id, view: 'coordinator' })).data.aiBatchCreatedAt).toBeFalsy()

    await signOut(auth)
    const instructor = accounts.find((account) => account.label === 'מנחה קורס')!
    await signInWithEmailAndPassword(auth, instructor.email, instructor.password)
    const getInstructorWorkspace = httpsCallable<{ cycleId: string }, { courses: Array<{ label: string; students: string[] }> }>(functions, 'getInstructorWorkspace')
    const instructorWorkspace = (await getInstructorWorkspace({ cycleId: demoCycle.id })).data
    expect(instructorWorkspace.courses.some((course) => course.label === 'תיאטרון')).toBe(true)
    const createdInstructorWorkspace=(await getInstructorWorkspace({cycleId:created.id})).data
    expect(createdInstructorWorkspace.courses.some(course=>course.label==='תיאטרון')).toBe(true)
    expect((await downloadWord({cycleId:created.id})).data.base64).toBe(wordBase64)
    await signOut(auth)
    const studentAccount=accounts.find(account=>account.label==='תלמיד')!
    await signInWithEmailAndPassword(auth,studentAccount.email,studentAccount.password)
    expect((await downloadWord({cycleId:created.id})).data.base64).toBe(wordBase64)
  })
  it('enforces per-cluster classes across catalog, draft, submit and assignment', async () => {
    const call = async <T,>(name:string,data:Record<string,unknown>={}) => (await httpsCallable<Record<string,unknown>,T>(functions,name)(data)).data
    const coordinator=accounts.find(a=>a.label==='רכז שיבוץ')!
    const student=accounts.find(a=>a.label==='תלמיד')!
    await signOut(auth);await signInWithEmailAndPassword(auth,coordinator.email,coordinator.password)
    const classes=await call<Array<{id:string}>>('listEligibleClasses')
    expect(classes.map(c=>c.id)).toEqual(['class-demo-7a','class-demo-7b'])
    let cycle=await call<AssignmentCycle>('createCycle',{schoolYear:schoolYearId(currentSchoolYearStart()),termLabel:'כיתות במקבצים'})
    const teachers=await call<Array<{uid:string}>>('listEligibleInstructors')
    const course={label:'קורס',instructorIds:[teachers[0].uid],minimum:0,target:10,maximum:20,repeatPolicy:'allowed'}
    const clusters=[{label:'ז1 בלבד',eligibleClassIds:['class-demo-7a'],requiredRankingCount:1,courses:[course]},{label:'ז2 בלבד',eligibleClassIds:['class-demo-7b'],requiredRankingCount:1,courses:[course]},{label:'כולם',requiredRankingCount:1,courses:[course]}]
    for(const invalid of [[],['another-school-class']]) await expect(call('saveCycleCatalog',{cycleId:cycle.id,clusters:[{...clusters[0],eligibleClassIds:invalid}]})).rejects.toMatchObject({code:'functions/invalid-argument'})
    const catalog=await call<ChoiceContext['catalog']>('saveCycleCatalog',{cycleId:cycle.id,expectedVersion:cycle.version,formDesign:{title:'בדיקת כיתות',theme:'teal',layout:'cards',documentUrl:'https://docs.google.com/document/d/private-source/edit',documentLinkVisible:false},clusters})
    cycle=await call<AssignmentCycle>('getCycle',{cycleId:cycle.id})
    cycle=await call<AssignmentCycle>('transitionCycle',{cycleId:cycle.id,expectedVersion:cycle.version,to:'choice_open',reason:'test',idempotencyKey:'class-open'})
    await expect(call('saveCycleCatalog',{cycleId:cycle.id,clusters})).rejects.toMatchObject({code:'functions/failed-precondition'})
    await signOut(auth);await signInWithEmailAndPassword(auth,student.email,student.password)
    await expect(call('listEligibleClasses')).rejects.toMatchObject({code:'functions/permission-denied'})
    const context=await call<ChoiceContext>('getChoiceContext',{cycleId:cycle.id})
    expect(context.catalog.clusters.map(c=>c.label)).toEqual(['ז1 בלבד','כולם'])
    expect(context.catalog.formDesign?.documentUrl).toBe('')
    expect(context.catalog.formDesign?.documentLinkVisible).toBe(false)
    const preferences=context.catalog.clusters.map(c=>({clusterId:c.clusterId,rankings:[{courseId:c.courses[0].courseId,rank:1}]}))
    await expect(call('savePreferenceDraft',{cycleId:cycle.id,expectedVersion:0,idempotencyKey:'forged-class',preferences:[...preferences,{clusterId:catalog.clusters[1].clusterId,rankings:[]}],classId:'class-demo-7b'})).rejects.toMatchObject({code:'functions/failed-precondition'})
    const draft=await call<PreferenceSubmission>('savePreferenceDraft',{cycleId:cycle.id,expectedVersion:0,idempotencyKey:'class-draft',preferences})
    const user=await getAdminAuth(adminApp).getUser(auth.currentUser!.uid)
    try {
      await getAdminAuth(adminApp).setCustomUserClaims(user.uid,{...user.customClaims,classId:'class-demo-7b'})
      await auth.currentUser!.getIdToken(true)
      const movedContext=await call<ChoiceContext>('getChoiceContext',{cycleId:cycle.id})
      expect(movedContext.catalog.clusters.map(c=>c.label)).toEqual(['ז2 בלבד','כולם'])
      expect(movedContext.catalog.formDesign?.documentUrl).toBe('')
      await expect(call('submitPreferences',{cycleId:cycle.id,expectedDraftVersion:draft.version,submissionVersion:1,idempotencyKey:'class-moved-submit'})).rejects.toMatchObject({code:'functions/failed-precondition'})
    } finally {
      await getAdminAuth(adminApp).setCustomUserClaims(user.uid,user.customClaims!)
      await auth.currentUser!.getIdToken(true)
    }
    const submitted=await call<PreferenceSubmission>('submitPreferences',{cycleId:cycle.id,expectedDraftVersion:draft.version,submissionVersion:1,idempotencyKey:'class-valid-submit'})
    expect(submitted.catalogSnapshot).toHaveLength(2)
    await signOut(auth);await signInWithEmailAndPassword(auth,coordinator.email,coordinator.password)
    cycle=await call<AssignmentCycle>('transitionCycle',{cycleId:cycle.id,expectedVersion:cycle.version,to:'choice_closed',reason:'test',idempotencyKey:'class-close'})
    let workflow=await call<WorkflowState>('generateAiEvaluations',{cycleId:cycle.id})
    for(const evaluation of workflow.aiEvaluations) workflow=await call<WorkflowState>('approveAiEvaluation',{cycleId:cycle.id,evaluationId:evaluation.id,priority:'neutral',summary:'test',reason:'test'})
    cycle=await call<AssignmentCycle>('getCycle',{cycleId:cycle.id})
    await call('transitionCycle',{cycleId:cycle.id,expectedVersion:cycle.version,to:'assignment',reason:'test',idempotencyKey:'class-assign'})
    workflow=await call<WorkflowState>('runAssignment',{cycleId:cycle.id})
    expect(workflow.assignmentRun!.assignments.map(a=>a.clusterId).sort()).toEqual(context.catalog.clusters.map(c=>c.clusterId).sort())
  })

  it('accepts only the three canonical school years and retains archive history beyond 50 cycles',async()=>{
    await signOut(auth)
    const coordinator=accounts.find(a=>a.label==='רכז שיבוץ')!
    await signInWithEmailAndPassword(auth,coordinator.email,coordinator.password)
    const create=httpsCallable<Record<string,unknown>,AssignmentCycle>(functions,'createCycle')
    const start=currentSchoolYearStart()
    for(const schoolYear of ['תשפ״ז','2026/2027',schoolYearId(start-2),schoolYearId(start+2)]) await expect(create({schoolYear,termLabel:'bad'})).rejects.toMatchObject({code:'functions/invalid-argument'})
    for(const year of [start-1,start,start+1]) expect((await create({schoolYear:schoolYearId(year),termLabel:'בדיקת שנה'})).data.schoolYear).toBe(schoolYearId(year))
    const db=getFirestore(adminApp), batch=db.batch()
    for(let i=0;i<51;i++){
      const id=`archive-test-${i}`,base=`organizations/${demoCycle.organizationId}`
      batch.set(db.doc(`${base}/nativCycles/${id}`),{...demoCycle,id,schoolYear:schoolYearId(start-2),status:'closed'})
      batch.set(db.doc(`${base}/nativCatalogSnapshots/${id}`),{...demoCatalogSnapshot,cycleId:id})
      batch.set(db.doc(`${base}/nativCourseCatalogs/${id}`),{courses:demoCourses.map(c=>({...c,cycleId:id}))})
    }
    await batch.commit()
    const cycles=(await httpsCallable<undefined,AssignmentCycle[]>(functions,'listCycles')()).data
    expect(cycles.filter(c=>c.id.startsWith('archive-test-'))).toHaveLength(51)
    expect(cycles.some(c=>c.schoolYear===schoolYearId(start))).toBe(true)
  })

})
