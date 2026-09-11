import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const auth = require('firebase-tools/lib/auth.js')
const account = auth.getAllAccounts().find((entry) => entry.user.email === 'edtrack.dynamic@gmail.com')
if (!account?.tokens?.refresh_token) throw new Error('Project operator login required.')
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }
const serviceUrl = 'https://serviceusage.googleapis.com/v1/projects/369491378125/services/drive.googleapis.com'
const current = await fetch(serviceUrl, { headers })
if (!current.ok) throw new Error(`Drive API status failed: HTTP ${current.status}`)
const state = (await current.json()).state
if (state !== 'ENABLED') {
  const enabled = await fetch(`${serviceUrl}:enable`, { method: 'POST', headers, body: '{}' })
  if (!enabled.ok) throw new Error(`Drive API enable failed: HTTP ${enabled.status}`)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const check = await fetch(serviceUrl, { headers })
    if (check.ok && (await check.json()).state === 'ENABLED') break
    if (attempt === 11) throw new Error('Drive API did not become enabled in time.')
  }
}
console.log(JSON.stringify({ service: 'drive.googleapis.com', state: 'ENABLED' }))
