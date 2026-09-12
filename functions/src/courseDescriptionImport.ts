import { GoogleAuth } from 'google-auth-library'
import { getStorage } from 'firebase-admin/storage'
import { randomUUID } from 'node:crypto'
import mammoth from 'mammoth'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { extractCourseDescriptionsWithGemini, type CourseCandidate } from '../../server/gemini/courseDescriptionExtraction'
import { safeCycleDocumentPath, safeLink } from '../../src/domain/formDesign'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { CycleCatalogSnapshot, Course } from '../../src/domain/catalog'
import { catalogSnapshotDocumentPath, courseCatalogDocumentPath, cycleDocumentPath } from '../../server/firestore/paths'
import { actorFromRequest, inputRecord, requiredString } from './request'
import { adminApp, callableOptions, nativFirestore } from './firebase'

const geminiSecret = defineSecret('GEMINI_API_KEY')
export const documentReaderEmail = '369491378125-compute@developer.gserviceaccount.com'
const maxFileBytes = 4 * 1024 * 1024

function documentBucket() {
  const projectId = adminApp.options.projectId || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
  if (!projectId) throw new HttpsError('unavailable', 'אחסון המסמכים אינו מוגדר')
  return getStorage(adminApp).bucket(`${projectId}.firebasestorage.app`)
}

export async function verifyStoredCycleDocument(path: string): Promise<void> {
  const file=documentBucket().file(path)
  const [exists]=await file.exists()
  if (!exists) throw new HttpsError('not-found', 'קובץ Word לא נמצא. הוסיפו אותו שוב למחזור.')
  const [metadata]=await file.getMetadata()
  if (Number(metadata.size) > maxFileBytes || metadata.contentType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') throw new HttpsError('invalid-argument', 'קובץ Word אינו תקין')
}

function storedPath(organizationId: string, cycleId: string, fileId: string): string {
  return `organizations/${organizationId}/nativCycles/${cycleId}/source-documents/${fileId}.docx`
}

function assertStoredPath(path: string, organizationId: string, cycleId: string): string {
  const safe = safeCycleDocumentPath(path)
  if (!safe.startsWith(`organizations/${organizationId}/nativCycles/${cycleId}/source-documents/`)) throw new HttpsError('permission-denied', 'המסמך אינו שייך למחזור')
  return safe
}

function decodeWord(base64: unknown): Buffer {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64) || base64.length > Math.ceil(maxFileBytes / 3) * 4 + 4) throw new HttpsError('invalid-argument', 'קובץ Word אינו תקין או גדול מ־4MB')
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length || bytes.length > maxFileBytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new HttpsError('invalid-argument', 'יש לבחור קובץ DOCX תקין עד 4MB')
  return bytes
}

export const uploadCycleDocument = onCall({ ...callableOptions, memory: '512MiB' }, async request => {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה להוסיף מסמך למחזור')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const fileName = requiredString(data, 'fileName').slice(0, 200)
  if (!fileName.toLowerCase().endsWith('.docx')) throw new HttpsError('invalid-argument', 'יש לבחור קובץ Word מסוג DOCX')
  const cycle = (await nativFirestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get()).data() as AssignmentCycle | undefined
  if (cycle?.status !== 'draft') throw new HttpsError('failed-precondition', 'אפשר להחליף מסמך רק לפני פתיחת הבחירה')
  const bytes = decodeWord(data.base64)
  try { await mammoth.extractRawText({ buffer: bytes }) } catch { throw new HttpsError('invalid-argument', 'לא ניתן לקרוא את קובץ Word') }
  const path = storedPath(actor.organizationId, cycleId, randomUUID())
  await documentBucket().file(path).save(bytes, { resumable: false, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', metadata: { cacheControl: 'private, max-age=0', metadata: { organizationId: actor.organizationId, cycleId, uploadedBy: actor.uid } } })
  return { path, fileName }
})

export const downloadCycleDocument = onCall(callableOptions, async request => {
  const actor = await actorFromRequest(request, 'read')
  const data = inputRecord(request.data)
  const cycleId = requiredString(data, 'cycleId')
  const [cycleSnapshot, catalogSnapshot, coursesSnapshot] = await Promise.all([
    nativFirestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get(),
    nativFirestore.doc(catalogSnapshotDocumentPath(actor.organizationId, cycleId)).get(),
    nativFirestore.doc(courseCatalogDocumentPath(actor.organizationId, cycleId)).get(),
  ])
  const cycle = cycleSnapshot.data() as AssignmentCycle | undefined
  if (!cycle) throw new HttpsError('not-found', 'התהליך לא נמצא')
  const catalog = catalogSnapshot.data() as CycleCatalogSnapshot | undefined
  const stored = catalog?.formDesign?.documentStoragePath
  const isManager = actor.capabilities.includes('nativ.assignment.manage')
  const isInstructor = actor.roles.includes('course_instructor') && ((coursesSnapshot.data()?.courses ?? []) as Course[]).some(course => course.instructorIds.includes(actor.uid))
  const isStudent = actor.roles.includes('student') && cycle.status !== 'draft' && Boolean(catalog?.formDesign?.documentLinkVisible)
  if (!isManager && !isInstructor && !isStudent) throw new HttpsError('permission-denied', 'אין הרשאה לצפות במסמך')
  const previewPath = isManager && cycle.status === 'draft' && typeof data.previewPath === 'string' ? assertStoredPath(data.previewPath, actor.organizationId, cycleId) : ''
  const path = previewPath || stored
  if (!path) throw new HttpsError('not-found', 'לא הוגדר מסמך Word למחזור')
  assertStoredPath(path, actor.organizationId, cycleId)
  await verifyStoredCycleDocument(path)
  const [bytes] = await documentBucket().file(path).download()
  if (bytes.length > maxFileBytes) throw new HttpsError('resource-exhausted', 'המסמך גדול מדי')
  return { base64: bytes.toString('base64'), fileName: previewPath ? 'תקצירי הקורסים.docx' : (catalog?.formDesign?.documentName || 'תקצירי הקורסים.docx') }
})

export function googleDocumentId(url: string): string {
  const safe = safeLink(url, true)
  const match = new URL(safe).pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new HttpsError('invalid-argument', 'קישור Google Docs אינו תקין')
  return match[1]
}

async function downloadGoogleDoc(url: string): Promise<Buffer> {
  const id = googleDocumentId(url)
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] }).getClient()
  const token = await client.getAccessToken()
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.wordprocessingml.document')}`, { headers: { Authorization: `Bearer ${token.token}` }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new HttpsError(response.status === 404 ? 'not-found' : 'permission-denied', `לא ניתן לקרוא את המסמך. שתפו אותו לצפייה עם ${documentReaderEmail} ונסו שוב.`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxFileBytes) throw new HttpsError('invalid-argument', 'המסמך גדול מדי. ניתן לקרוא מסמך עד 4MB.')
  return bytes
}

function parseCandidates(value: unknown): CourseCandidate[] {
  if (!Array.isArray(value) || !value.length || value.length > 800) throw new HttpsError('invalid-argument', 'יש לשלוח רשימת קורסים תקינה')
  const candidates = value.map(entry => {
    const data = inputRecord(entry)
    const id = requiredString(data, 'id').slice(0, 100)
    const label = requiredString(data, 'label').slice(0, 200)
    const instructorNames = Array.isArray(data.instructorNames) ? data.instructorNames.filter((name): name is string => typeof name === 'string').map(name => name.trim().slice(0, 200)).filter(Boolean).slice(0, 10) : []
    return { id, label, instructorNames }
  })
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new HttpsError('invalid-argument', 'מזהי הקורסים אינם ייחודיים')
  return candidates
}

export const extractCourseDescriptions = onCall({ ...callableOptions, secrets: [geminiSecret], timeoutSeconds: 180, memory: '512MiB' }, async request => {
  const actor = await actorFromRequest(request)
  if (!actor.capabilities.includes('nativ.assignment.manage')) throw new HttpsError('permission-denied', 'אין הרשאה לייבא תיאורי קורסים')
  const data = inputRecord(request.data)
  const candidates = parseCandidates(data.candidates)
  let bytes: Buffer
  if (data.kind === 'google_docs') bytes = await downloadGoogleDoc(requiredString(data, 'url'))
  else if (data.kind === 'stored_docx') {
    const cycleId = requiredString(data, 'cycleId')
    const path = assertStoredPath(requiredString(data, 'path'), actor.organizationId, cycleId)
    const cycle = (await nativFirestore.doc(cycleDocumentPath(actor.organizationId, cycleId)).get()).data() as AssignmentCycle | undefined
    if (cycle?.status !== 'draft') throw new HttpsError('failed-precondition', 'אפשר לייבא תיאורים רק לפני פתיחת הבחירה')
    ;[bytes] = await documentBucket().file(path).download()
    if (bytes.length > maxFileBytes) throw new HttpsError('invalid-argument', 'המסמך גדול מדי')
  }
  else if (data.kind === 'docx') {
    const fileName = requiredString(data, 'fileName')
    if (!fileName.toLocaleLowerCase().endsWith('.docx') || typeof data.base64 !== 'string') throw new HttpsError('invalid-argument', 'יש לבחור קובץ Word מסוג DOCX')
    bytes = decodeWord(data.base64)
  } else throw new HttpsError('invalid-argument', 'יש לבחור Google Docs או קובץ Word')
  let text: string
  try { text = (await mammoth.extractRawText({ buffer: bytes })).value.split('\u0000').join('').trim().slice(0, 120000) }
  catch { throw new HttpsError('invalid-argument', 'לא ניתן לקרוא את המסמך. ודאו שזהו קובץ DOCX תקין.') }
  if (text.length < 20) throw new HttpsError('invalid-argument', 'לא נמצא מספיק טקסט במסמך')
  try { return { results: await extractCourseDescriptionsWithGemini(geminiSecret.value(), text, candidates), readerEmail: documentReaderEmail } }
  catch (error) { throw new HttpsError('unavailable', error instanceof Error ? error.message : 'זיהוי התיאורים נכשל') }
})
