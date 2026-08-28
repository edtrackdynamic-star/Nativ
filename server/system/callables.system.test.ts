import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth'
import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import type { WorkflowState } from '../../src/domain/workflow'
import { demoCycle, demoSubmission } from '../../src/demo/demoCycle'

interface SeedResult {
  cycleId: string
  accounts: Array<{ label: string; email: string; password: string }>
}

describe('Nativ callable system flow', () => {
  let app: FirebaseApp
  let auth: Auth
  let functions: Functions
  let accounts: SeedResult['accounts']

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

    const approveRun = httpsCallable<{ cycleId: string }, WorkflowState>(functions, 'approveAssignmentRun')
    workflow = (await approveRun({ cycleId: demoCycle.id })).data
    expect(workflow.assignmentRun?.approvedAt).toBeTruthy()
    expect(workflow.assignmentRun?.publishedAt).toBeUndefined()
    const publish = httpsCallable<{ cycleId: string }, WorkflowState>(functions, 'publishAssignments')
    workflow = (await publish({ cycleId: demoCycle.id })).data
    expect(workflow.assignmentRun?.publishedAt).toBeTruthy()
    expect(workflow.notifications).toHaveLength(4)
    await transition({ cycleId: demoCycle.id, expectedVersion: 4, to: 'appeals', reason: 'פתיחת ערעורים בבדיקת מערכת', idempotencyKey: 'system-open-appeals' })

    await signOut(auth)
    const student = accounts.find((account) => account.label === 'תלמיד')!
    await signInWithEmailAndPassword(auth, student.email, student.password)
    const current = workflow.assignmentRun!.assignments.find((entry) => entry.clusterId === 'cluster-arts')!
    const requestedCourseId = current.courseId === 'course-theater' ? 'course-music' : 'course-theater'
    const submitAppeal = httpsCallable<Record<string, unknown>, { id: string }>(functions, 'submitAppeal')
    const appeal = (await submitAppeal({ cycleId: demoCycle.id, clusterId: 'cluster-arts', requestedCourseId, reason: 'בקשת בדיקת מערכת' })).data

    await signOut(auth)
    const coordinator = accounts.find((account) => account.label === 'רכז שיבוץ')!
    await signInWithEmailAndPassword(auth, coordinator.email, coordinator.password)
    const analyze = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'analyzeAppeal')
    workflow = (await analyze({ cycleId: demoCycle.id, appealId: appeal.id })).data
    const analyzed = workflow.appeals.find((entry) => entry.id === appeal.id)!
    expect(analyzed.analysis).toMatchObject({ beforeCourseId: current.courseId, afterCourseId: requestedCourseId, requiresMovingAnotherStudent: false })
    expect(analyzed.originalSubmission?.preferences).toHaveLength(2)

    const decide = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'decideAppeal')
    workflow = (await decide({ cycleId: demoCycle.id, appealId: appeal.id, outcome: 'approved', reason: 'אפשרי לאחר ניתוח' })).data
    expect(workflow.assignmentRun!.assignments.find((entry) => entry.studentId === 'student-demo-001' && entry.clusterId === 'cluster-arts')!.courseId).toBe(current.courseId)
    expect(workflow.appeals.find((entry) => entry.id === appeal.id)?.status).toBe('approved_pending_execution')

    const execute = httpsCallable<Record<string, unknown>, WorkflowState>(functions, 'executeAppealChange')
    workflow = (await execute({ cycleId: demoCycle.id, appealId: appeal.id, expectedWorkflowVersion: workflow.version })).data
    expect(workflow.assignmentRun!.assignments.find((entry) => entry.studentId === 'student-demo-001' && entry.clusterId === 'cluster-arts')!.courseId).toBe(requestedCourseId)
    expect(workflow.appeals.find((entry) => entry.id === appeal.id)?.status).toBe('executed')
    expect(workflow.notifications.filter((entry) => entry.audience === 'secretary')).toHaveLength(2)
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
    const updated = (await setAccess({ uid: secretary.uid, roles: ['secretary', 'access_manager'], active: true })).data
    expect(updated.roles).toEqual(['secretary', 'access_manager'])
  })
})
