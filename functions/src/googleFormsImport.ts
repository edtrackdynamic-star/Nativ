import { createHash, randomUUID } from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { CycleCatalogSnapshot } from '../../src/domain/catalog'
import { validatePreferenceSubmission, type ClusterPreference, type PreferenceSubmission } from '../../src/domain/preferences'
import { auditEventDocumentPath, catalogSnapshotDocumentPath, cycleDocumentPath, organizationCollectionPath, submissionDocumentPath } from '../../server/firestore/paths'
import { callableOptions, coreFirestore, nativFirestore } from './firebase'
import { actorFromRequest, inputRecord, requiredString } from './request'
import { studentAssignmentProfiles } from './workflowCallables'
import { readGoogleFormsFile } from './googleFormsFile'

interface ColumnMapping {
  name: number
  className: number
  courses: Record<string, number>
  rationales: Record<string, number>
  students: Record<string, string>
}
interface ImportStudent { id: string; name: string; classId: string; className: string }
interface ImportRow { row: number; name: string; className: string; studentId: string; choices: ClusterPreference[]; errors: string[]; duplicateOf?: number; sourceTimestamp: string; fingerprint: string }

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/[׳״'"`\u200e\u200f]/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase()
}

function normalizeClass(value: string): string { return normalize(value).replace(/^כיתה\s*/u, '').replace(/\s+/gu, '') }

function mappedIndex(value: unknown, length: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length ? value : -1
}

function rank(value: string): number | null {
  const normalized = normalize(value)
  const digit = /(?:^|\s)([1-9])(?:$|\s)/u.exec(normalized)?.[1]
  if (digit) return Number(digit)
  const words = ['ראשונ', 'שני', 'שליש', 'רביע', 'חמיש', 'שיש', 'שביע', 'שמינ', 'תשיע']
  const found = words.findIndex((word) => normalized.includes(word))
  return found < 0 ? null : found + 1
}

export function suggestMapping(headers: string[], catalog: CycleCatalogSnapshot): ColumnMapping {
  const name = headers.findIndex((header) => /שם.*(מלא|תלמיד)|שם פרטי.*משפחה/u.test(header))
  const className = headers.findIndex((header) => /כיתה|כיתת.*אם/u.test(header))
  const courses: Record<string, number> = {}
  const rationales: Record<string, number> = {}
  for (const cluster of catalog.clusters) {
    for (const course of cluster.courses) {
      const matches = headers.map((header, index) => normalize(header).includes(normalize(course.label)) ? index : -1).filter((index) => index >= 0)
      if (matches.length === 1) courses[course.courseId] = matches[0]
    }
    const day = cluster.weeklySlot?.weekday === 3 ? /רביעי|יום ד/u : cluster.weeklySlot?.weekday === 4 ? /חמישי|יום ה/u : null
    const matches = headers.map((header, index) => /נימוק|סיבה|הסבר/u.test(header) && (normalize(header).includes(normalize(cluster.label)) || Boolean(day?.test(header))) ? index : -1).filter((index) => index >= 0)
    if (matches.length === 1) rationales[cluster.clusterId] = matches[0]
  }
  return { name: name >= 0 ? name : 1, className: className >= 0 ? className : 2, courses, rationales, students: {} }
}

function parseMapping(value: unknown, headers: string[], suggested: ColumnMapping): ColumnMapping {
  if (!value || typeof value !== 'object') return suggested
  const data = value as Record<string, unknown>
  const readMap = (item: unknown): Record<string, number> => {
    if (!item || typeof item !== 'object') return {}
    return Object.fromEntries(Object.entries(item).filter(([key, index]) => key.length < 150 && mappedIndex(index, headers.length) >= 0)) as Record<string, number>
  }
  const students = data.students && typeof data.students === 'object' ? Object.fromEntries(Object.entries(data.students).filter(([row, id]) => /^\d{1,5}$/u.test(row) && typeof id === 'string' && id.length < 150)) as Record<string, string> : {}
  return { name: mappedIndex(data.name, headers.length), className: mappedIndex(data.className, headers.length), courses: readMap(data.courses), rationales: readMap(data.rationales), students }
}

async function activeStudents(organizationId: string): Promise<ImportStudent[]> {
  let ids: string[]
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    ids = []
    let pageToken: string | undefined
    do {
      const page = await getAuth().listUsers(1000, pageToken)
      ids.push(...page.users.filter((user) => user.customClaims?.organizationId === organizationId && user.customClaims?.active !== false && user.customClaims?.roles?.includes('student')).map((user) => user.uid))
      pageToken = page.pageToken
    } while (pageToken)
  } else {
    const members = await coreFirestore.collection(`organizations/${organizationId}/members`).where('role', '==', 'student').get()
    ids = members.docs.filter((entry) => entry.data().active === true).map((entry) => entry.id)
  }
  const profiles = await studentAssignmentProfiles(organizationId, ids)
  return ids.map((id) => ({ id, name: profiles.get(id)?.displayLabel ?? '', classId: profiles.get(id)?.classId ?? '', className: profiles.get(id)?.classLabel ?? '' }))
}

export function readRows(rows: string[][], catalog: CycleCatalogSnapshot, students: ImportStudent[], mapping: ColumnMapping): ImportRow[] {
  const result: ImportRow[] = []
  const byId = new Map(students.map((student) => [student.id, student]))
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index]
    const row = index + 1
    const name = cells[mapping.name]?.trim() ?? ''
    const className = cells[mapping.className]?.trim() ?? ''
    const matching = students.filter((student) => normalize(student.name) === normalize(name) && normalizeClass(student.className) === normalizeClass(className))
    const override = mapping.students[String(row)]
    const selected = override ? byId.get(override) : matching.length === 1 ? matching[0] : undefined
    const errors: string[] = []
    if (mapping.name < 0 || mapping.className < 0) errors.push('יש לבחור עמודות שם וכיתה')
    if (!name || !className) errors.push('חסרים שם או כיתה')
    if (override && !selected) errors.push('התלמיד שנבחר אינו פעיל באדטרק')
    if (!selected && !override && name && className) errors.push(matching.length ? 'נמצאו כמה תלמידים עם אותו שם וכיתה' : 'לא נמצא תלמיד תואם ברשימת בית הספר')
    const choices: ClusterPreference[] = []
    if (selected) for (const cluster of catalog.clusters.filter((item) => !item.eligibleClassIds?.length || item.eligibleClassIds.includes(selected.classId))) {
      const rankings: ClusterPreference['rankings'] = []
      for (const course of cluster.courses) {
        const column = mapping.courses[course.courseId]
        if (mappedIndex(column, rows[0].length) < 0) { errors.push(`חסרה התאמת עמודה לקורס ${course.label}`); continue }
        const value = cells[column]?.trim() ?? ''
        if (!value && rankings.length >= cluster.requiredRankingCount) continue
        const position = rank(value)
        if (position !== null) rankings.push({ courseId: course.courseId, rank: position })
        else if (value) errors.push(`דירוג לא מזוהה בקורס ${course.label}`)
      }
      const rationaleColumn = mapping.rationales[cluster.clusterId]
      const rationale = mappedIndex(rationaleColumn, rows[0].length) >= 0 ? cells[rationaleColumn]?.trim() : undefined
      if (cluster.rationaleMode !== 'hidden' && rationaleColumn === undefined) errors.push(`חסרה התאמת עמודת נימוק למקבץ ${cluster.label}`)
      const preference = { clusterId: cluster.clusterId, rankings, ...(rationale ? { rationale } : {}) }
      choices.push(preference)
      const mock = { organizationId: catalog.organizationId, cycleId: catalog.cycleId, catalogSnapshot: [cluster], preferences: [preference], status: 'submitted' as const, submittedAt: new Date().toISOString() } as PreferenceSubmission
      for (const issue of validatePreferenceSubmission(mock, { organizationId: catalog.organizationId, id: catalog.cycleId, status: 'choice_open' } as AssignmentCycle)) errors.push(issue.message)
    }
    if (selected && !choices.length) errors.push('לא נמצא לתלמיד מקבץ מתאים במחזור')
    const sourceTimestamp = cells[0]?.trim() ?? ''
    const fingerprint = createHash('sha256').update(JSON.stringify({ studentId: selected?.id, choices, sourceTimestamp })).digest('hex')
    result.push({ row, name, className, studentId: selected?.id ?? '', choices, errors: [...new Set(errors)], sourceTimestamp, fingerprint })
  }
  const latest = new Map<string, ImportRow>()
  for (const entry of result) if (entry.studentId) latest.set(entry.studentId, entry)
  for (const entry of result) if (entry.studentId && latest.get(entry.studentId) !== entry) {
    const winner = latest.get(entry.studentId)!
    if (normalize(entry.name) !== normalize(winner.name) || normalizeClass(entry.className) !== normalizeClass(winner.className)) {
      const error = 'שורות עם שמות או כיתות שונים שויכו לאותו תלמיד. יש לבדוק את השיוך'
      entry.errors.push(error); winner.errors.push(error)
    } else entry.duplicateOf = winner.row
  }
  return result
}

async function context(organizationId: string, cycleId: string) {
  const [cycleSnapshot, catalogSnapshot, students] = await Promise.all([
    nativFirestore.doc(cycleDocumentPath(organizationId, cycleId)).get(),
    nativFirestore.doc(catalogSnapshotDocumentPath(organizationId, cycleId)).get(),
    activeStudents(organizationId),
  ])
  if (!cycleSnapshot.exists || !catalogSnapshot.exists) throw new HttpsError('not-found', 'לא נמצא מחזור עם מקבצים מוכנים')
  const cycle = cycleSnapshot.data() as AssignmentCycle
  if (cycle.status !== 'choice_open') throw new HttpsError('failed-precondition', 'אפשר לקלוט בחירות רק כשהמחזור בשלב בחירה פתוחה')
  return { cycle, catalog: catalogSnapshot.data() as CycleCatalogSnapshot, students }
}

async function prepare(organizationId: string, data: Record<string, unknown>) {
  const cycleId = requiredString(data, 'cycleId')
  const fileName = requiredString(data, 'fileName')
  const fileBase64 = requiredString(data, 'fileBase64')
  const { cycle, catalog, students } = await context(organizationId, cycleId)
  const sourceRows = readGoogleFormsFile(fileBase64, fileName)
  const headers = sourceRows[0].map((header) => header.trim())
  const suggested = suggestMapping(headers, catalog)
  const mapping = parseMapping(data.mapping, headers, suggested)
  const rows = readRows(sourceRows, catalog, students, mapping)
  return { cycle, catalog, students, headers, mapping, rows, cycleId }
}

export const previewGoogleFormsImport = onCall({ ...callableOptions, memory: '512MiB' }, async (request) => {
  const actor = await actorFromRequest(request, 'read')
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'קליטת בחירות זמינה לרכזי השיבוץ בלבד')
  const prepared = await prepare(actor.organizationId, inputRecord(request.data))
  const existing = await nativFirestore.collection(organizationCollectionPath(actor.organizationId, 'submissions')).where('cycleId', '==', prepared.cycleId).get()
  const inApp = new Set(existing.docs.map((document) => document.data() as PreferenceSubmission).filter((entry) => entry.status === 'submitted' && entry.source === 'nativ_app').map((entry) => entry.studentId))
  for (const row of prepared.rows) if (!row.duplicateOf && inApp.has(row.studentId)) row.errors.push('לתלמיד כבר קיימת הגשה בנתיב; יש לבדוק אותה לפני ייבוא')
  const effective = prepared.rows.filter((row) => !row.duplicateOf)
  return { headers: prepared.headers, mapping: prepared.mapping, students: prepared.students, rows: prepared.rows.map(({ row, name, className, studentId, errors, duplicateOf }) => ({ row, name, className, studentId, errors, duplicateOf })), total: prepared.rows.length, ready: effective.filter((row) => !row.errors.length).length, blocked: effective.filter((row) => row.errors.length).length, replaced: prepared.rows.length - effective.length }
})

export const commitGoogleFormsImport = onCall({ ...callableOptions, memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'קליטת בחירות זמינה לרכזי השיבוץ בלבד')
  const prepared = await prepare(actor.organizationId, inputRecord(request.data))
  const active = prepared.rows.filter((row) => !row.duplicateOf)
  if (active.length > 180) throw new HttpsError('resource-exhausted', 'בקובץ יש יותר מ־180 תלמידים. יש לפצל את הייבוא ולבדוק כל חלק בנפרד')
  if (active.some((row) => row.errors.length)) throw new HttpsError('failed-precondition', 'יש לתקן את כל השורות המסומנות לפני קליטה')
  const collection = nativFirestore.collection(organizationCollectionPath(actor.organizationId, 'submissions'))
  const now = new Date().toISOString()
  return nativFirestore.runTransaction(async (transaction) => {
    const cycleRef = nativFirestore.doc(cycleDocumentPath(actor.organizationId, prepared.cycleId))
    const cycleSnapshot = await transaction.get(cycleRef)
    if (cycleSnapshot.data()?.status !== 'choice_open') throw new HttpsError('failed-precondition', 'המחזור נסגר בינתיים. יש לרענן לפני קליטה')
    const existing = await transaction.get(collection.where('cycleId', '==', prepared.cycleId))
    const byStudent = new Map<string, PreferenceSubmission[]>()
    for (const document of existing.docs) {
      const submission = document.data() as PreferenceSubmission
      const list = byStudent.get(submission.studentId) ?? []
      list.push(submission)
      byStudent.set(submission.studentId, list)
    }
    let created = 0, unchanged = 0
    for (const row of active) {
      const previous = byStudent.get(row.studentId) ?? []
      if (previous.some((entry) => entry.source === 'nativ_app' && entry.status === 'submitted')) throw new HttpsError('failed-precondition', `ל־${row.name} כבר קיימת בחירה שהוגשה בנתיב. יש לבדוק אותה לפני ייבוא`)
      if (previous.some((entry) => entry.importFingerprint === row.fingerprint)) { unchanged++; continue }
      const latest = Math.max(0, ...previous.map((entry) => entry.submissionVersion))
      const id = `form-${prepared.cycleId}-${row.studentId}-${row.fingerprint.slice(0, 16)}`
      const eligible = prepared.catalog.clusters.filter((cluster) => !cluster.eligibleClassIds?.length || cluster.eligibleClassIds.includes(prepared.students.find((student) => student.id === row.studentId)?.classId ?? ''))
      const submission: PreferenceSubmission = {
        id, organizationId: actor.organizationId, cycleId: prepared.cycleId, studentId: row.studentId,
        submissionVersion: latest + 1, status: 'submitted', source: 'google_forms_import', importFingerprint: row.fingerprint,
        externalSubmittedAt: row.sourceTimestamp, submittedAt: now, catalogSnapshot: structuredClone(eligible), preferences: row.choices,
        version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      }
      const issues = validatePreferenceSubmission(submission, { ...prepared.cycle, choiceDeadlineEnabled: false })
      if (issues.length) throw new HttpsError('failed-precondition', `${row.name}: ${issues.map((issue) => issue.message).join(', ')}`)
      transaction.create(nativFirestore.doc(submissionDocumentPath(actor.organizationId, id)), submission)
      const auditId = randomUUID()
      transaction.create(nativFirestore.doc(auditEventDocumentPath(actor.organizationId, auditId)), { id: auditId, organizationId: actor.organizationId, actorId: actor.uid, occurredAt: now, action: 'preference.imported', entityType: 'PreferenceSubmission', entityId: id, reason: `ייבוא תשובות מטופס חיצוני, שורה ${row.row}`, afterVersion: 1 })
      created++
    }
    return { created, unchanged, superseded: prepared.rows.length - active.length }
  })
})
