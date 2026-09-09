import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
if (!process.argv.includes('--live')) throw new Error('Pass --live for the approved synthetic Gemini connectivity check.')
const auth = require('firebase-tools/lib/auth.js')
const account = auth.getAllAccounts().find((entry) => entry.user.email === 'edtrack.dynamic@gmail.com')
if (!account?.tokens?.refresh_token) throw new Error('Project operator login required.')
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
const response = await fetch('https://secretmanager.googleapis.com/v1/projects/edtrack-development/secrets/GEMINI_API_KEY/versions/latest:access', { headers: { Authorization: `Bearer ${token.access_token}` } })
if (!response.ok) throw new Error(`Secret access failed: HTTP ${response.status}`)
const secret = await response.json()
const key = Buffer.from(secret.payload.data, 'base64').toString('utf8')
const model = 'gemini-2.5-flash'
const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(60000),
  body: JSON.stringify({ contents: [{ parts: [{ text: 'Synthetic connection test. Return JSON with status set to ok.' }] }], generationConfig: { temperature: 0, maxOutputTokens: 128, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { status: { type: 'STRING' } }, required: ['status'] } } }),
})
if (!result.ok) throw new Error(`Gemini connectivity failed: HTTP ${result.status}`)
const data = await result.json()
const output = JSON.parse(data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '{}')
if (output.status !== 'ok') throw new Error('Unexpected synthetic response.')
console.log(JSON.stringify({ project: 'edtrack-development', secret: 'GEMINI_API_KEY', model, structuredOutput: 'passed', realStudentDataSent: false }))
