import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const origin = process.argv[2]
const root = new URL('../dist/', import.meta.url)
const html = await readFile(new URL('index.html', root), 'utf8')
const manifestBytes = await readFile(new URL('manifest.webmanifest', root))
const manifest = JSON.parse(manifestBytes)
assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/)
assert.match(html, /rel="apple-touch-icon"/)
assert.equal(manifest.name, 'נתיב')
assert.equal(manifest.short_name, 'נתיב')
assert.equal(manifest.display, 'standalone')
for (const field of ['id', 'start_url', 'scope']) assert.equal(manifest[field], '/')
assert(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === 'any'))
assert(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'any'))
assert(manifest.icons.some(icon => icon.purpose === 'maskable'))
const paths = new Set(['/manifest.webmanifest'])
for (const icon of [...manifest.icons, {src:'/icons/nativ-180.png?v=65442c9', sizes:'180x180'}, {src:'/icons/nativ-48.png?v=65442c9', sizes:'48x48'}]) {
  assert.match(icon.src, /^\/icons\/[a-z0-9-]+\.png\?v=[a-z0-9]+$/)
  const bytes = await readFile(new URL(icon.src.slice(1), root))
  assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes)
  paths.add(icon.src)
}
if (origin) {
  const live = await fetch(new URL('/', origin), {cache:'no-store'})
  assert(live.ok)
  assert.match(live.headers.get('cache-control') ?? '', /(?:no-cache|no-store)/)
  assert.match(await live.text(), /rel="manifest" href="\/manifest.webmanifest"/)
  for (const path of [...paths, '/index.html', '/nativ-mark.png?v=65442c9']) {
    const response = await fetch(new URL(path, origin), {cache:'no-store'})
    assert.equal(response.status, 200, path)
    assert.match(response.headers.get('cache-control') ?? '', /(?:no-cache|no-store|max-age=0)/, path)
    assert.match(response.headers.get('content-type') ?? '', path.includes('.png') ? /image\/png/ : path.endsWith('.html') ? /text\/html/ : /application\/manifest\+json/)
    const local = await readFile(new URL(path.slice(1), root))
    const remote = Buffer.from(await response.arrayBuffer())
    const hash = bytes => createHash('sha256').update(bytes).digest('hex')
    assert.equal(hash(remote), hash(local), path)
  }
}
console.log(JSON.stringify({manifest:'valid', icons:paths.size-1, display:manifest.display, verifiedOrigin:origin ?? 'local build'}))
