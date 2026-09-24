import { randomUUID } from 'node:crypto'
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { CycleCatalogSnapshot } from '../../src/domain/catalog'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import { catalogSnapshotDocumentPath, cycleDocumentPath, organizationCollectionPath } from '../firestore/paths'

interface Preview {
  mapping: { name: number; className: number; courses: Record<string, number>; rationales: Record<string, number>; students: Record<string, string> }
  rows: { row: number; studentId: string; errors: string[]; duplicateOf?: number }[]
  ready: number
  blocked: number
  replaced: number
}

describe('Google Forms import callable flow', () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Firebase Emulators required')
  const suffix = randomUUID().slice(0, 8)
  const organizationId = `org-forms-${suffix}`
  const cycleId = `cycle-forms-${suffix}`
  const coordinatorId = `forms-coordinator-${suffix}`
  const studentZId = `forms-student-z-${suffix}`
  const studentTId = `forms-student-t-${suffix}`
  const password = 'Testing123!'
  const admin = initializeAdminApp({ projectId: 'demo-nativ-local' }, `forms-import-${suffix}`)
  const database = getFirestore(admin)
  const adminAuth = getAdminAuth(admin)
  const app = initializeApp({ projectId: 'demo-nativ-local', apiKey: 'demo-api-key' }, `forms-client-${suffix}`)
  const auth = getAuth(app)
  const functions = getFunctions(app, 'europe-west1')
  const preview = httpsCallable<Record<string, unknown>, Preview>(functions, 'previewGoogleFormsImport')
  const commit = httpsCallable<Record<string, unknown>, { created: number; unchanged: number; superseded: number }>(functions, 'commitGoogleFormsImport')
  const headers = ['חותמת זמן', 'שם מלא', 'כיתה', 'סיבה יום רביעי', 'אמנות', 'תיאטרון', 'חוק ומשפט', 'פודקסטים', 'סיבה יום חמישי']
  const response = (date: string, name: string, className: string, reasonWednesday: string, art: string, theater: string, law: string, media: string, reasonThursday: string) =>
    [date, name, className, reasonWednesday, art, theater, law, media, reasonThursday].map((value) => `"${value.replaceAll('"', '""')}"`).join(',')
  const payload = (rows: string[]) => ({ cycleId, fileName: 'responses.csv', fileBase64: Buffer.from([headers.join(','), ...rows].join('\r\n'), 'utf8').toString('base64') })
  const first = response('2026-09-01 09:00', 'דנה כהן', 'ז1', 'אני אוהבת אמנות', 'עדיפות ראשונה', 'עדיפות שניה', 'עדיפות שניה', 'עדיפות ראשונה', 'אני אוהבת ליצור')
  const latest = response('2026-09-02 09:00', 'דנה כהן', 'ז1', 'אני מעדיפה תיאטרון', 'עדיפות שניה', 'עדיפות ראשונה', 'עדיפות ראשונה', 'עדיפות שניה', 'אני רוצה ללמוד חוק')
  const ninth = response('2026-09-02 10:00', 'רוני לוי', 'ט', '', '', '', 'עדיפות שניה', 'עדיפות ראשונה', '')
  const file = payload([first, latest, ninth])

  beforeAll(async () => {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
    const users = [
      { uid: coordinatorId, email: `forms-coordinator-${suffix}@example.test`, displayName: 'רכז', roles: ['placement_coordinator'] },
      { uid: studentZId, email: `forms-z-${suffix}@example.test`, displayName: 'דנה כהן', roles: ['student'], classId: 'z', classLabel: 'כיתה ז׳1' },
      { uid: studentTId, email: `forms-t-${suffix}@example.test`, displayName: 'רוני לוי', roles: ['student'], classId: 't', classLabel: 'כיתה ט' },
    ]
    for (const user of users) {
      await adminAuth.createUser({ uid: user.uid, email: user.email, password, displayName: user.displayName })
      await adminAuth.setCustomUserClaims(user.uid, { organizationId, active: true, roles: user.roles, ...(user.classId ? { classId: user.classId, classLabel: user.classLabel } : {}) })
    }
    const cycle = { id: cycleId, organizationId, status: 'choice_open', choiceDeadlineEnabled: true, choiceClosesAt: '2026-09-01T00:00:00.000Z', version: 1, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', createdBy: coordinatorId, updatedBy: coordinatorId } as AssignmentCycle
    const catalog = { id: `catalog-${cycleId}`, organizationId, cycleId, version: 1, createdAt: cycle.createdAt, updatedAt: cycle.updatedAt, createdBy: coordinatorId, updatedBy: coordinatorId, clusters: [
      { clusterId: 'wednesday', label: 'יום רביעי', requiredRankingCount: 2, eligibleClassIds: ['z'], rationaleMode: 'optional', weeklySlot: { weekday: 3, periodStart: 1, periodEnd: 2 }, courses: [{ courseId: 'art', logicalCourseId: 'art', label: 'אמנות' }, { courseId: 'theater', logicalCourseId: 'theater', label: 'תיאטרון' }] },
      { clusterId: 'thursday', label: 'יום חמישי', requiredRankingCount: 2, eligibleClassIds: ['z', 't'], rationaleMode: 'optional', weeklySlot: { weekday: 4, periodStart: 1, periodEnd: 2 }, courses: [{ courseId: 'law', logicalCourseId: 'law', label: 'חוק ומשפט' }, { courseId: 'media', logicalCourseId: 'media', label: 'פודקסטים' }] },
    ] } as CycleCatalogSnapshot
    await Promise.all([
      database.doc(cycleDocumentPath(organizationId, cycleId)).set(cycle),
      database.doc(catalogSnapshotDocumentPath(organizationId, cycleId)).set(catalog),
    ])
    await signInWithEmailAndPassword(auth, users[0].email, password)
  })

  afterAll(async () => {
    await signOut(auth).catch(() => undefined)
    await deleteApp(app)
    await deleteAdminApp(admin)
  })

  it('previews eligible choices, duplicate response and deadline-closed import', async () => {
    const result = (await preview(file)).data
    expect(result).toMatchObject({ ready: 2, blocked: 0, replaced: 1 })
    expect(result.rows[0].duplicateOf).toBe(3)
    expect(result.rows[1].studentId).toBe(studentZId)
    expect(result.rows[2].studentId).toBe(studentTId)
    expect(result.mapping.courses).toEqual({ art: 4, theater: 5, law: 6, media: 7 })
  })

  it('blocks bad rankings atomically before any write', async () => {
    const broken = payload([first, response('2026-09-02 09:00', 'דנה כהן', 'ז1', '', 'עדיפות ראשונה', 'עדיפות ראשונה', 'עדיפות ראשונה', 'עדיפות שניה', ''), ninth])
    expect((await preview(broken)).data.blocked).toBe(1)
    await expect(commit(broken)).rejects.toMatchObject({ code: 'functions/failed-precondition' })
    const saved = await database.collection(organizationCollectionPath(organizationId, 'submissions')).get()
    expect(saved.empty).toBe(true)
  })

  it('commits once, keeps rationale and eligibility, and is idempotent', async () => {
    expect((await commit(file)).data).toEqual({ created: 2, unchanged: 0, superseded: 1 })
    const submissions = await database.collection(organizationCollectionPath(organizationId, 'submissions')).get()
    expect(submissions.size).toBe(2)
    const z = submissions.docs.map((doc) => doc.data() as PreferenceSubmission).find((entry) => entry.studentId === studentZId)!
    const t = submissions.docs.map((doc) => doc.data() as PreferenceSubmission).find((entry) => entry.studentId === studentTId)!
    expect(z.preferences).toHaveLength(2)
    expect(z.preferences[0].rationale).toBe('אני מעדיפה תיאטרון')
    expect(z.preferences[0].rankings.find((entry) => entry.courseId === 'theater')?.rank).toBe(1)
    expect(t.preferences.map((entry) => entry.clusterId)).toEqual(['thursday'])
    expect(z).toMatchObject({ source: 'google_forms_import', submissionVersion: 1 })
    expect((await commit(file)).data).toEqual({ created: 0, unchanged: 2, superseded: 1 })
    expect((await database.collection(organizationCollectionPath(organizationId, 'submissions')).get()).size).toBe(2)
    expect((await database.collection(organizationCollectionPath(organizationId, 'auditEvents')).get()).size).toBe(2)
  })

  it('versions a changed response but refuses to overwrite an in-app submission', async () => {
    const changed = payload([first, response('2026-09-03 09:00', 'דנה כהן', 'ז1', 'רוצה להתנסות אחרת', 'עדיפות ראשונה', 'עדיפות שניה', 'עדיפות ראשונה', 'עדיפות שניה', ''), ninth])
    expect((await commit(changed)).data).toMatchObject({ created: 1, unchanged: 1 })
    const submissions = await database.collection(organizationCollectionPath(organizationId, 'submissions')).where('studentId', '==', studentZId).get()
    expect(submissions.docs.map((doc) => (doc.data() as PreferenceSubmission).submissionVersion).sort()).toEqual([1, 2])
    await database.doc(`${organizationCollectionPath(organizationId, 'submissions')}/in-app`).set({ ...submissions.docs[0].data(), id: 'in-app', studentId: studentTId, source: 'nativ_app', submissionVersion: 2 })
    expect((await preview(file)).data.blocked).toBe(1)
    await expect(commit(file)).rejects.toMatchObject({ code: 'functions/failed-precondition' })
  })

  it('denies students and unauthenticated users both operations', async () => {
    await signOut(auth)
    await signInWithEmailAndPassword(auth, `forms-z-${suffix}@example.test`, password)
    await expect(preview(file)).rejects.toMatchObject({ code: 'functions/permission-denied' })
    await expect(commit(file)).rejects.toMatchObject({ code: 'functions/permission-denied' })
    await signOut(auth)
    await expect(preview(file)).rejects.toMatchObject({ code: 'functions/unauthenticated' })
  })
})
