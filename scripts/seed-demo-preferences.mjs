import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { buildDemoPreferencePlan, demoOrganizationId } from './demo-preference-plan.mjs'

const require = createRequire(import.meta.url)
const project = 'edtrack-development'
const coreRoot = `projects/${project}/databases/(default)/documents`
const nativRoot = `projects/${project}/databases/nativ/documents`
const cycleId = process.argv.find((arg) => arg.startsWith('--cycle='))?.slice(8)
const apply = process.argv.includes('--apply')
const approvedHash = process.argv.find((arg) => arg.startsWith('--plan-hash='))?.slice(12)
if (!cycleId || !/^cycle-[a-z0-9-]+$/i.test(cycleId)) throw new Error('Specify an existing demo cycle with --cycle=cycle-…')
if (apply && !/^[a-f0-9]{64}$/.test(approvedHash ?? '')) throw new Error('Apply requires the exact --plan-hash from a fresh preview.')

function fromValue(value) {
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fromValue)
  if ('mapValue' in value) return fromFields(value.mapValue.fields ?? {})
  if ('nullValue' in value) return null
  throw new Error('Unexpected Firestore value in demo school.')
}
function fromFields(fields) { return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)])) }
function toValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return { integerValue: String(value) }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
  if (typeof value === 'object') return { mapValue: { fields: toFields(value) } }
  throw new Error('Unexpected value in demo preference plan.')
}
function toFields(value) { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, toValue(entry)])) }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

async function token() {
  const accounts = require('firebase-tools/lib/auth.js').getAllAccounts()
  for (const email of ['edtrack.dynamic@gmail.com', 'boobely@gmail.com']) {
    const account = accounts.find((entry) => entry.user.email === email)
    if (!account?.tokens?.refresh_token) continue
    try {
      const value = await require('firebase-tools/lib/auth.js').getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
      if (value.access_token) return value.access_token
    } catch { /* Try the other existing operator account. */ }
  }
  throw new Error('Firebase CLI login expired. Run firebase login --reauth with a project operator account, then retry the preview. No data was changed.')
}
async function request(accessToken, url, options = {}) {
  const response = await fetch(`https://firestore.googleapis.com/v1/${url}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  if (response.status === 404 && !options.method) return null
  if (!response.ok) throw new Error(`Firestore ${options.method ?? 'read'} failed: HTTP ${response.status} ${(await response.text()).slice(0, 500)}. No completion should be assumed; check the demo roster before retrying.`)
  return response.json()
}
async function document(accessToken, root, path) { return request(accessToken, `${root}/${path}`) }
async function collection(accessToken, root, path) {
  const docs = []
  let pageToken
  do {
    const parameters = new URLSearchParams({ pageSize: '100' })
    if (pageToken) parameters.set('pageToken', pageToken)
    const page = await request(accessToken, `${root}/${path}?${parameters}`)
    docs.push(...(page?.documents ?? []))
    pageToken = page?.nextPageToken
  } while (pageToken)
  return docs
}
function value(doc) { return { ...fromFields(doc.fields ?? {}), id: doc.name.split('/').at(-1) } }
function verify(doc) { return { verify: doc.name, currentDocument: { updateTime: doc.updateTime } } }

const accessToken = await token()
const base = `organizations/${demoOrganizationId}`
const [organization, cycleDoc, catalogDoc, memberDocs, submissionDocs] = await Promise.all([
  document(accessToken, coreRoot, base),
  document(accessToken, nativRoot, `${base}/nativCycles/${cycleId}`),
  document(accessToken, nativRoot, `${base}/nativCatalogSnapshots/${cycleId}`),
  collection(accessToken, coreRoot, `${base}/members`),
  collection(accessToken, nativRoot, `${base}/nativSubmissions`),
])
if (!organization || !cycleDoc || !catalogDoc || value(organization).isDemo !== true || value(organization).active !== true) throw new Error('The active demo organization, cycle, or catalog is missing. No data was changed.')
const members = memberDocs.map(value)
const activeStudentDocs = memberDocs.filter((doc) => doc.fields?.active?.booleanValue === true && doc.fields?.role?.stringValue === 'student')
const profileDocs = await Promise.all(activeStudentDocs.map((doc) => document(accessToken, coreRoot, `${base}/students/${doc.name.split('/').at(-1)}`)))
if (profileDocs.some((doc) => !doc)) throw new Error('A demo student profile is missing. No data was changed.')
const profiles = new Map(profileDocs.map((doc) => [value(doc).id, value(doc)]))
const submissions = submissionDocs.map(value).filter((entry) => entry.cycleId === cycleId)
const now = new Date().toISOString()
const plan = buildDemoPreferencePlan({ cycle: value(cycleDoc), catalog: value(catalogDoc), members, profiles, submissions, now })
const fingerprint = createHash('sha256').update(stable({
  organization: organization.updateTime, cycle: cycleDoc.updateTime, catalog: catalogDoc.updateTime,
  members: activeStudentDocs.map((doc) => [doc.name, doc.updateTime]),
  profiles: profileDocs.map((doc) => [doc.name, doc.updateTime]),
  submissions: submissionDocs.filter((doc) => doc.fields?.cycleId?.stringValue === cycleId).map((doc) => [doc.name, doc.updateTime]).sort(),
  candidates: plan.candidates.map((entry) => [entry.id, entry.preferences]),
})).digest('hex')
console.log(JSON.stringify({ organizationId: demoOrganizationId, cycleId, activeStudents: plan.activeStudentCount, alreadySubmitted: plan.alreadySubmittedCount, toCreate: plan.candidates.length, planHash: fingerprint, mode: apply ? 'apply' : 'preview' }))
if (apply) {
  if (approvedHash !== fingerprint) throw new Error('Demo data changed after preview. Run preview again; no data was changed.')
  if (!plan.candidates.length) process.exit(0)
  // A Firestore commit can verify only documents in its own database. Core
  // identity/class documents were checked in the plan hash immediately above.
  const writes = [verify(cycleDoc), verify(catalogDoc)]
  for (const candidate of plan.candidates) {
    const submissionName = `${nativRoot}/${base}/nativSubmissions/${candidate.id}`
    const created = { ...candidate, version: 1, submittedAt: now, createdAt: now, updatedAt: now, createdBy: 'demo-preference-seed', updatedBy: 'demo-preference-seed' }
    writes.push({ update: { name: submissionName, fields: toFields(created) }, currentDocument: { exists: false } })
    const eventId = randomUUID()
    const audit = { id: eventId, organizationId: demoOrganizationId, actorId: 'demo-preference-seed', occurredAt: now, action: 'preference.demo_seed.created', entityType: 'PreferenceSubmission', entityId: candidate.id, reason: 'בחירות לצורך בדיקת שיבוץ בבית הספר להדגמה', afterVersion: 1 }
    writes.push({ update: { name: `${nativRoot}/${base}/nativAuditEvents/${eventId}`, fields: toFields(audit) }, currentDocument: { exists: false } })
  }
  if (writes.length > 400) throw new Error('The plan is too large for one safe commit. No data was changed.')
  await request(accessToken, `${nativRoot}:commit`, { method: 'POST', body: JSON.stringify({ writes }) })
  const after = await collection(accessToken, nativRoot, `${base}/nativSubmissions`)
  const createdIds = new Set(after.map((doc) => doc.name.split('/').at(-1)))
  if (plan.candidates.some((entry) => !createdIds.has(entry.id))) throw new Error('The commit returned but verification is incomplete. Check the demo roster before retrying.')
  console.log(JSON.stringify({ createdAndVerified: plan.candidates.length, existingSubmissionsUntouched: plan.alreadySubmittedCount, nextStep: 'Review preferences and start evaluation in Nativ; no assignment was run or published.' }))
}
