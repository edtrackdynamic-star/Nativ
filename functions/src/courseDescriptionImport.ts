import { GoogleAuth } from 'google-auth-library'
import mammoth from 'mammoth'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { extractCourseDescriptionsWithGemini, type CourseCandidate } from '../../server/gemini/courseDescriptionExtraction'
import { safeLink } from '../../src/domain/formDesign'
import { actorFromRequest, inputRecord, requiredString } from './request'
import { callableOptions } from './firebase'

const geminiSecret = defineSecret('GEMINI_API_KEY')
export const documentReaderEmail = '369491378125-compute@developer.gserviceaccount.com'
const maxFileBytes = 4 * 1024 * 1024

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
  else if (data.kind === 'docx') {
    const fileName = requiredString(data, 'fileName')
    if (!fileName.toLocaleLowerCase().endsWith('.docx') || typeof data.base64 !== 'string') throw new HttpsError('invalid-argument', 'יש לבחור קובץ Word מסוג DOCX')
    bytes = Buffer.from(data.base64, 'base64')
    if (!bytes.length || bytes.length > maxFileBytes) throw new HttpsError('invalid-argument', 'ניתן לקרוא קובץ Word עד 4MB')
  } else throw new HttpsError('invalid-argument', 'יש לבחור Google Docs או קובץ Word')
  let text: string
  try { text = (await mammoth.extractRawText({ buffer: bytes })).value.split('\u0000').join('').trim().slice(0, 120000) }
  catch { throw new HttpsError('invalid-argument', 'לא ניתן לקרוא את המסמך. ודאו שזהו קובץ DOCX תקין.') }
  if (text.length < 20) throw new HttpsError('invalid-argument', 'לא נמצא מספיק טקסט במסמך')
  try { return { results: await extractCourseDescriptionsWithGemini(geminiSecret.value(), text, candidates), readerEmail: documentReaderEmail } }
  catch (error) { throw new HttpsError('unavailable', error instanceof Error ? error.message : 'זיהוי התיאורים נכשל') }
})
