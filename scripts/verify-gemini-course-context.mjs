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
const courses = [
  { courseId: 'synthetic-art', label: 'אמנות בקרטון', description: 'יצירת אמנות מקרטון ומחומרים יומיומיים', rank: 1 },
  { courseId: 'synthetic-science', label: 'ניסויים במדעים', description: 'חקר מדעי וניסויי מעבדה', rank: 2 },
]
const results = await evaluateWithGemini(key, [
  { id: 'general-interest', rationale: 'אני אוהבת יצירה ואמנות', clusterLabel: 'מקבץ קורסי בחירה', courses },
  { id: 'concrete-goal', rationale: 'בניתי דגמים מקרטון בבית ואני רוצה ללמוד איך לתכנן מבנה יציב שלא קורס.', clusterLabel: 'מקבץ קורסי בחירה', courses },
  { id: 'explicit-rejection', rationale: 'אני מתעניין ברפואה והצלת חיים ומעדיף לא פילאטיס.', clusterLabel: 'מקבץ קורסי בחירה', courses: [
    { courseId: 'synthetic-medicine', label: 'רפואה והצלת חיים', description: 'היכרות עם רפואה ועזרה ראשונה', rank: 1 },
    { courseId: 'synthetic-pilates', label: 'פילאטיס', description: 'תנועה, יציבה וחיזוק הגוף', rank: 2 },
  ] },
])
const general = results.find((entry) => entry.id === 'general-interest')
const concrete = results.find((entry) => entry.id === 'concrete-goal')
const rejected = results.find((entry) => entry.id === 'explicit-rejection')
if (!general || !concrete || !rejected || general.courses.length !== 2 || concrete.courses.length !== 2 || rejected.courses.length !== 2) throw new Error('Unexpected course evaluation result.')
if (general.courses.find((entry) => entry.courseId === 'synthetic-art')?.priority !== 'medium'
  || general.courses.find((entry) => entry.courseId === 'synthetic-science')?.priority !== 'neutral'
  || concrete.courses.find((entry) => entry.courseId === 'synthetic-art')?.priority !== 'high'
  || rejected.courses.find((entry) => entry.courseId === 'synthetic-pilates')?.priority !== 'negative') {
  throw new Error(`Course rubric mismatch: ${JSON.stringify({ general: general.courses.map((entry) => entry.priority), concrete: concrete.courses.map((entry) => entry.priority), rejected: rejected.courses.map((entry) => entry.priority) })}`)
}
console.log(JSON.stringify({ model: 'gemini-2.5-flash', structuredOutput: 'passed', general: general.courses.map((entry) => entry.priority), concrete: concrete.courses.map((entry) => entry.priority), rejected: rejected.courses.map((entry) => entry.priority), realStudentDataSent: false }))
