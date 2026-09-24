import { inflateRawSync } from 'node:zlib'
import { HttpsError } from 'firebase-functions/v2/https'

const maxFileBytes = 6 * 1024 * 1024
const maxXmlBytes = 16 * 1024 * 1024
const maxRows = 1500
const maxColumns = 80

function xmlText(value: string): string {
  return value.replace(/&#x([0-9a-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/giu, (_, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
    if (hex || decimal) {
      const code = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[named?.toLowerCase() ?? ''] ?? ''
  })
}

function zipEntry(buffer: Buffer, name: string): Buffer {
  // Read the central directory, not local-header lengths: exported XLSX files may use data descriptors.
  let end = -1
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break }
  }
  if (end < 0) throw new HttpsError('invalid-argument', 'קובץ ה־Excel אינו תקין')
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressed = buffer.readUInt32LE(offset + 20)
    const expanded = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const entryName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (entryName === name) {
      if (expanded > maxXmlBytes || compressed > maxFileBytes) throw new HttpsError('invalid-argument', 'הגיליון גדול מדי לייבוא')
      const local = buffer.readUInt32LE(offset + 42)
      if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) break
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
      if (start + compressed > buffer.length) break
      const body = buffer.subarray(start, start + compressed)
      const result = method === 0 ? body : method === 8 ? inflateRawSync(body, { maxOutputLength: maxXmlBytes }) : null
      if (!result || result.length !== expanded) break
      return result
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new HttpsError('invalid-argument', 'לא נמצאה לשונית תגובות תקינה בקובץ ה־Excel')
}

function columnIndex(reference: string): number {
  let result = 0
  for (const letter of reference.toUpperCase()) result = result * 26 + letter.charCodeAt(0) - 64
  return result - 1
}

function xlsxRows(buffer: Buffer): string[][] {
  const strings: string[] = []
  try {
    const shared = zipEntry(buffer, 'xl/sharedStrings.xml').toString('utf8')
    for (const item of shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)) {
      strings.push([...item[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)].map((text) => xmlText(text[1])).join(''))
    }
  } catch (error) {
    if (!(error instanceof HttpsError)) throw error
    // Google Sheets can export inline strings without a shared-string table.
  }
  const xml = zipEntry(buffer, 'xl/worksheets/sheet1.xml').toString('utf8')
  const rows: string[][] = []
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    if (rows.length >= maxRows + 1) throw new HttpsError('invalid-argument', 'בקובץ יש יותר מדי תשובות')
    const values: string[] = []
    for (const cell of row[1].matchAll(/<c\b([^>]*)(?:\/\s*>|>([\s\S]*?)<\/c>)/gu)) {
      const ref = /\br="([A-Z]+)\d+"/u.exec(cell[1])?.[1]
      if (!ref) continue
      const index = columnIndex(ref)
      if (index >= maxColumns) throw new HttpsError('invalid-argument', 'בקובץ יש יותר מדי עמודות')
      const body = cell[2] ?? ''
      if (/<f(?:\s|>)/u.test(body)) throw new HttpsError('invalid-argument', 'הקובץ מכיל נוסחאות. יש לייצא מחדש את גיליון התגובות המקורי')
      const raw = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1] ?? [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)].map((text) => text[1]).join('')
      values[index] = /\bt="s"/u.test(cell[1]) ? strings[Number(raw)] ?? '' : xmlText(raw)
    }
    rows.push(values)
  }
  return rows
}

function csvRows(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++ } else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index++
      row.push(cell); rows.push(row); row = []; cell = ''
      if (rows.length > maxRows + 1) throw new HttpsError('invalid-argument', 'בקובץ יש יותר מדי תשובות')
    } else cell += char
  }
  if (quoted) throw new HttpsError('invalid-argument', 'מבנה קובץ ה־CSV אינו תקין')
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export function readGoogleFormsFile(base64: string, fileName: string): string[][] {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(base64) || base64.length > maxFileBytes * 1.4) throw new HttpsError('invalid-argument', 'הקובץ גדול מדי או אינו תקין')
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length || buffer.length > maxFileBytes) throw new HttpsError('invalid-argument', 'הקובץ גדול מדי או ריק')
  const rows = /\.xlsx$/iu.test(fileName) ? xlsxRows(buffer) : /\.csv$/iu.test(fileName) ? csvRows(buffer.toString('utf8').replace(/^\uFEFF/u, '')) : null
  if (!rows?.length || rows[0].length > maxColumns) throw new HttpsError('invalid-argument', 'יש להעלות קובץ Excel או CSV של תגובות הטופס')
  return rows.filter((row) => row.some((cell) => cell?.trim()))
}
