import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth'
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import type { WorkflowState } from '../../src/domain/workflow'
import { demoCycle, demoSubmission } from '../../src/demo/demoCycle'
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

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
    const run = httpsCallable<{ cycleId: string }, WorkflowState>(functions, 'runAssignment')
    workflow = (await run({ cycleId: demoCycle.id })).data
    expect(workflow.assignmentRun?.assignments).toHaveLength(2)
    expect(workflow.assignmentRun).toMatchObject({ algorithmVersion: 'legacy-compatible-1.0.0', seed: 42 })
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
    expect(workflow.notifications).toHaveLength(4)
    const publicationEvents = await mailEvents()
    expect(publicationEvents.size).toBe(1)
    expect(publicationEvents.docs[0].data().jobs).toHaveLength(2)
    expect(JSON.stringify(publicationEvents.docs[0].data())).not.toMatch(/rationale|originalSubmission|aiEvaluation|explanation/)
    await expect(publish({ cycleId: demoCycle.id })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    expect((await mailEvents()).size).toBe(1)
    await transition({ cycleId: demoCycle.id, expectedVersion: 4, to: 'appeals', reason: 'פתיחת ערעורים בבדיקת מערכת', idempotencyKey: 'system-open-appeals' })

    await signOut(auth)
    const student = accounts.find((account) => account.label === 'תלמיד')!
    await signInWithEmailAndPassword(auth, student.email, student.password)
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
    expect(workflow.notifications.filter((entry) => entry.audience === 'secretary')).toHaveLength(2)
    expect(workflow.notifications.filter((entry) => entry.audience === 'student' && entry.channel === 'email')).toHaveLength(3)
    const changeEvents = await mailEvents()
    expect(changeEvents.size).toBe(2)
    const change = changeEvents.docs.find((doc) => doc.id.startsWith('appeal-'))!.data()
    expect(change.jobs.map((job: { audience: string }) => job.audience)).toEqual(['secretary', 'student'])
    expect(JSON.stringify(change)).not.toMatch(/rationale|originalSubmission|aiEvaluation|reason|analysis/)
    await expect(execute({ cycleId: demoCycle.id, appealId: appeal.id, expectedWorkflowVersion: workflow.version })).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    expect((await mailEvents()).size).toBe(2)
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
    const created = (await createCycle({ schoolYear: 'תשפ״ח', termLabel: 'מחצית א׳' })).data
    expect(created).toMatchObject({ status: 'draft', version: 1 })

    const listInstructors = httpsCallable<undefined, Array<{ uid: string; displayName: string }>>(functions, 'listEligibleInstructors')
    const instructors = (await listInstructors()).data
    expect(instructors.length).toBeGreaterThan(0)

    const saveCatalog = httpsCallable<Record<string, unknown>, { id: string }>(functions, 'saveCycleCatalog')
    await saveCatalog({
      cycleId: created.id,
      clusters: [{
        label: 'אמנויות',
        requiredRankingCount: 1,
        courses: [{
          label: 'תיאטרון',
          description: 'סדנת תיאטרון',
          subjectArea: 'אמנויות',
          instructorIds: [instructors[0].uid],
          minimum: 0,
          target: 18,
          maximum: 22,
          repeatPolicy: 'allowed',
        }],
      }],
    })

    const getCatalog = httpsCallable<{ cycleId: string }, { catalog: { clusters: unknown[] }; courses: unknown[] }>(functions, 'getCycleCatalog')
    const catalog = (await getCatalog({ cycleId: created.id })).data
    expect(catalog.catalog.clusters).toHaveLength(1)
    expect(catalog.catalog.clusters[0]).toMatchObject({ balanceByClass: false })
    expect(catalog.courses).toHaveLength(1)

    const listCycles = httpsCallable<undefined, AssignmentCycle[]>(functions, 'listCycles')
    expect((await listCycles()).data.some((cycle) => cycle.id === created.id)).toBe(true)

    const getCycle = httpsCallable<{ cycleId: string }, AssignmentCycle>(functions, 'getCycle')
    const configured = (await getCycle({ cycleId: created.id })).data
    const transition = httpsCallable<Record<string, unknown>, AssignmentCycle>(functions, 'transitionCycle')
    const opened = (await transition({ cycleId: created.id, expectedVersion: configured.version, to: 'choice_open', reason: 'פתיחת בדיקת מערכת', idempotencyKey: 'system-open-new-cycle' })).data
    await transition({ cycleId: created.id, expectedVersion: opened.version, to: 'choice_closed', reason: 'סיום בחירה ללא הגשות', idempotencyKey: 'system-close-empty-cycle' })

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
  })
})
