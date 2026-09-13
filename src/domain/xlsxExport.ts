import type { AssignmentBoard } from './assignmentBoard'
import { boardCellLabel } from './assignmentBoard'
import type { AssignmentRun } from './workflow'

const encoder = new TextEncoder()
const escaped = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const bytes = (value: string) => encoder.encode(value)
const column = (index: number): string => { let value = index + 1, label = ''; while (value) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26) } return label }
type Cell = string | number
interface SheetDefinition { name: string; rows: Cell[][]; widths: number[]; freezeRows: number; freezeCols: number; headerRows: number[]; merged?: string[]; filterRow?: number }
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/><color rgb="FF20344D"/></font><font><b/><sz val="15"/><name val="Arial"/><color rgb="FF143F68"/></font><font><b/><sz val="11"/><name val="Arial"/><color rgb="FFFFFFFF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174F7D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6FC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD8E4EF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
const sheetXml = (sheet: SheetDefinition) => {
  const widthCount = Math.max(...sheet.rows.map(row => row.length), sheet.widths.length, 1)
  const rowCount = sheet.rows.length
  const rows = sheet.rows.map((row, rowIndex) => {
    const number = rowIndex + 1
    const style = rowIndex === 0 ? 1 : sheet.headerRows.includes(number) ? 2 : rowIndex % 2 === 0 ? 3 : 4
    const lines = Math.max(1, ...row.map((cell, index) => Math.ceil(String(cell).length / Math.max(12, (sheet.widths[index] ?? 28) - 3))))
    const height = rowIndex === 0 ? 30 : Math.min(112, Math.max(sheet.headerRows.includes(number) ? 40 : 26, lines * 16 + 10))
    return `<row r="${number}" ht="${height}" customHeight="1">${row.map((cell, cellIndex) => {
      const ref = `${column(cellIndex)}${number}`
      return typeof cell === 'number' ? `<c r="${ref}" s="${style}"><v>${cell}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escaped(cell)}</t></is></c>`
    }).join('')}</row>`
  }).join('')
  const widths = Array.from({ length: widthCount }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${sheet.widths[index] ?? 28}" customWidth="1"/>`).join('')
  const pane = sheet.freezeRows || sheet.freezeCols ? `<pane xSplit="${sheet.freezeCols}" ySplit="${sheet.freezeRows}" topLeftCell="${column(sheet.freezeCols)}${sheet.freezeRows + 1}" state="frozen"/>` : ''
  const merges = sheet.merged?.length ? `<mergeCells count="${sheet.merged.length}">${sheet.merged.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''
  const filter = sheet.filterRow ? `<autoFilter ref="A${sheet.filterRow}:${column(widthCount - 1)}${Math.max(rowCount, sheet.filterRow)}"/>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${widths}</cols><sheetData>${rows}</sheetData>${merges}${filter}</worksheet>`
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function u16(value: number) { return [value & 255, (value >>> 8) & 255] }
function u32(value: number) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255] }
function zip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const local: number[] = [], central: number[] = []
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = bytes(name), contentBytes = bytes(content), crc = crc32(contentBytes), offset = local.length
    local.push(...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(contentBytes.length), ...u32(contentBytes.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes)
    for (const byte of contentBytes) local.push(byte)
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(contentBytes.length), ...u32(contentBytes.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes)
  }
  const count = Object.keys(files).length
  return Uint8Array.from([...local, ...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(central.length), ...u32(local.length), ...u16(0)])
}

export function createAssignmentWorkbook(board: AssignmentBoard, run: AssignmentRun): Uint8Array<ArrayBuffer> {
  const metadata = `${run.label ?? 'הרצת שיבוץ'} · ${new Date(run.executedAt).toLocaleString('he-IL')}`
  const sheets: SheetDefinition[] = []
  const byCourse: Cell[][] = [['שיבוץ לפי קורסים'], [metadata], ['מקבץ'], ['קורס'], ['מנחה'], ['מקום מפגש'], ['משובצים'], ['יעד'], ['מקסימום'], ['תלמידים']]
  const merged: string[] = []
  for (let index = 0; index < board.courses.length; index++) {
    const course = board.courses[index]
    byCourse[2].push(`${course.clusterLabel} · ${course.weeklySlot}`)
    byCourse[3].push(course.label)
    byCourse[4].push(course.instructorNames.join(', ') || 'לא הוגדר')
    byCourse[5].push(course.meetingPlace ?? 'לא הוגדר')
    byCourse[6].push(course.students.length)
    byCourse[7].push(course.target)
    byCourse[8].push(course.maximum)
    byCourse[9].push('')
    if (index > 0 && board.courses[index - 1].clusterId === course.clusterId) byCourse[2][index + 1] = ''
    for (let row = 0; row < course.students.length; row++) {
      const target = byCourse[row + 10] ?? (byCourse[row + 10] = [''])
      target[index + 1] = `${course.students[row].name} · ${course.students[row].classLabel}`
    }
  }
  for (let start = 0; start < board.courses.length;) {
    let end = start
    while (end + 1 < board.courses.length && board.courses[end + 1].clusterId === board.courses[start].clusterId) end++
    if (end > start) merged.push(`${column(start + 1)}3:${column(end + 1)}3`)
    start = end + 1
  }
  sheets.push({ name: 'שיבוץ לפי קורסים', rows: byCourse, widths: [16, ...board.courses.map(() => 35)], freezeRows: 10, freezeCols: 1, headerRows: [3, 4], merged })

  for (const classLabel of [...new Set(board.students.map(student => student.classLabel))]) {
    const students = board.students.filter(student => student.classLabel === classLabel)
    const rows: Cell[][] = [[`שיבוץ שיעורי בחירה · ${classLabel}`], [metadata], ["מס׳", 'שם התלמיד/ה', 'הוגש טופס', ...board.clusters.map(cluster => `${cluster.label} · ${cluster.weeklySlot}`)]]
    for (const [index, student] of students.entries()) rows.push([index + 1, student.name, student.hasForm ? 'כן' : 'לא', ...board.clusters.map(cluster => boardCellLabel(student.cells[cluster.id]))])
    sheets.push({ name: classLabel.startsWith('כיתה') ? classLabel : `כיתה ${classLabel}`, rows, widths: [7, 25, 14, ...board.clusters.map(() => 34)], freezeRows: 3, freezeCols: 2, headerRows: [3], filterRow: 3 })
  }

  const sourceLabels = { hard_constraint: 'אילוץ מאושר', ranked_choice: 'בחירה מדורגת', fallback_submitter: 'חלופה למגיש/ה', fallback_non_submitter: 'חלופה ללא טופס', manual: 'שיבוץ ידני' } as const
  const details: Cell[][] = [['פרטי השיבוץ'], [metadata], ['כיתה', 'תלמיד/ה', 'מקבץ', 'קורס או מצב', 'דירוג', 'אופן השיבוץ', 'הוגש טופס']]
  for (const student of board.students) for (const cluster of board.clusters) {
    const cell = student.cells[cluster.id]
    details.push([student.classLabel, student.name, cluster.label, boardCellLabel(cell), cell.assignment?.rank ?? '', cell.assignment ? sourceLabels[cell.assignment.source] : '', student.hasForm ? 'כן' : 'לא'])
  }
  sheets.push({ name: 'פירוט שיבוצים', rows: details, widths: [18, 25, 30, 40, 10, 22, 14], freezeRows: 3, freezeCols: 2, headerRows: [3], filterRow: 3 })
  if (board.issues.length) sheets.push({ name: 'נתונים לבדיקה', rows: [['נתונים לבדיקה'], [metadata], ['נושא'], ...board.issues.map(issue => [issue])], widths: [90], freezeRows: 3, freezeCols: 0, headerRows: [3] })

  const usedNames = new Set<string>()
  for (const sheet of sheets) {
    const base = sheet.name.replace(/[\\/*?:]/g, ' ').replaceAll('[', ' ').replaceAll(']', ' ').slice(0, 31)
    let name = base, suffix = 2
    while (usedNames.has(name)) name = `${base.slice(0, 28)} ${suffix++}`
    usedNames.add(name)
    sheet.name = name
  }
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${escaped(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': stylesXml,
  }
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = sheetXml(sheet) })
  return zip(files)
}
