import { createRequire } from 'node:module'

if (!process.argv.includes('--live')) throw new Error('Pass --live for the synthetic Gemini course-context check.')
const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../functions/package.json', import.meta.url))('esbuild')
const auth = require('firebase-tools/lib/auth.js')
const account = auth.getAllAccounts().find((entry) => entry.user.email === 'edtrack.dynamic@gmail.com')
if (!account?.tokens?.refresh_token) throw new Error('Project operator login required.')
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
const secretResponse = await fetch('https://secretmanager.googleapis.com/v1/projects/edtrack-development/secrets/GEMINI_API_KEY/versions/latest:access', { headers: { Authorization: `Bearer ${token.access_token}` } })
if (!secretResponse.ok) throw new Error(`Secret access failed: HTTP ${secretResponse.status}`)
const secret = await secretResponse.json()
const key = Buffer.from(secret.payload.data, 'base64').toString('utf8')
const bundled = await build({ entryPoints: ['server/gemini/evaluation.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
const { evaluateWithGemini } = await import(moduleUrl)
const results = await evaluateWithGemini(key, [{
  id: 'synthetic-choice',
  rationale: 'אני אוהבת ליצור ולצייר ורוצה ללמוד טכניקות חדשות בציור.',
  clusterLabel: 'מקבץ קורסי בחירה',
  courses: [
    { courseId: 'synthetic-art', label: 'ציור ואמנות', description: 'רישום, צבע ויצירה חזותית', rank: 1 },
    { courseId: 'synthetic-science', label: 'ניסויים במדעים', description: 'חקר מדעי וניסויי מעבדה', rank: 2 },
  ],
}])
if (results.length !== 1 || results[0].courses.length !== 2) throw new Error('Unexpected course evaluation result.')
console.log(JSON.stringify({ model: 'gemini-2.5-flash', structuredOutput: 'passed', courseIds: results[0].courses.map((course) => course.courseId), priorities: results[0].courses.map((course) => course.priority), realStudentDataSent: false }))
