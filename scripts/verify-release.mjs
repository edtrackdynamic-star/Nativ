import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const auth = require('firebase-tools/lib/auth.js')
const account = auth.getAllAccounts().find((entry) => entry.user.email === 'edtrack.dynamic@gmail.com')
if (!account?.tokens?.refresh_token) throw new Error('Project operator login required.')
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
const headers = { Authorization: `Bearer ${token.access_token}` }
const fn = await fetch('https://cloudfunctions.googleapis.com/v2/projects/edtrack-development/locations/europe-west1/functions/generateAiEvaluations', { headers })
if (!fn.ok) throw new Error(`Function verification failed: HTTP ${fn.status}`)
const config = await fn.json()
if (config.state !== 'ACTIVE' || !config.serviceConfig?.secretEnvironmentVariables?.some((entry) => entry.key === 'GEMINI_API_KEY')) throw new Error('Gemini function is not active with the expected secret binding.')
const roster = await fetch('https://cloudfunctions.googleapis.com/v2/projects/edtrack-development/locations/europe-west1/functions/getStudentRoster', { headers })
if (!roster.ok || (await roster.json()).state !== 'ACTIVE') throw new Error('Student roster function is not active.')
const origin = 'https://edtrack-nativ.web.app'
const localHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
const liveHtml = await (await fetch(origin, { cache: 'no-store' })).text()
const assets = [...localHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1])
if (!assets.length || assets.some((asset) => !liveHtml.includes(asset))) throw new Error('Live HTML does not reference this build.')
for (const asset of assets) {
  const local = await readFile(new URL('../dist' + asset, import.meta.url))
  const response = await fetch(origin + asset, { cache: 'no-store' })
  if (!response.ok) throw new Error('Live asset could not be read.')
  const remote = Buffer.from(await response.arrayBuffer())
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  if (hash(local) !== hash(remote)) throw new Error('Live asset differs from the approved build.')
}
console.log(JSON.stringify({ hosting: origin, assetsVerified: assets.length, geminiFunction: 'ACTIVE', secretBinding: 'GEMINI_API_KEY', rosterFunction: 'ACTIVE' }))
