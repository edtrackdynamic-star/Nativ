/** Spreadsheet TSV or a pipe-delimited Markdown table. */
export function parseTable(text: string): string[][] {
  if (text.length > 200000) throw new Error('הטבלה גדולה מדי. הדביקו עד 200 שורות בכל פעם.')
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.trim().split('\n').filter(line => line.trim())
  if (!text.includes('\t') && lines.every(line => line.trim().startsWith('|') && line.trim().endsWith('|'))) {
    const markdownRows = lines.map(line => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(value => value.trim().replace(/\\\|/g, '|')))
      .filter(cells => !cells.every(value => /^:?-{3,}:?$/.test(value)))
    if (!markdownRows.length) throw new Error('יש להדביק טבלה עם קורס אחד לפחות.')
    if (markdownRows.length > 201) throw new Error('הדביקו עד 200 שורות וכותרת בכל פעם.')
    if (markdownRows.some(row => row.length !== markdownRows[0].length)) throw new Error('מספר התאים אינו אחיד בשורות. בדקו את מפרידי הטבלה.')
    return markdownRows
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' && (quoted || !cell)) {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted
    } else if (!quoted && (c === '\t' || c === '\n')) {
      row.push(cell.trim()); cell = ''
      if (c === '\n') { if (row.some(Boolean)) rows.push(row); row = [] }
    } else cell += c
  }
  if (quoted) throw new Error('יש תא עם מירכאות שלא נסגרו. העתיקו שוב את הטבלה.')
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row)
  if (rows.length > 201) throw new Error('הדביקו עד 200 שורות וכותרת בכל פעם.')
  if (!rows.length) throw new Error('יש להדביק טבלה עם קורס אחד לפחות.')
  return rows
}

export function capacityError(minimum: number | string, target: number | string, maximum: number | string): string {
  const values = [minimum, target, maximum]
  if (values.some(v => String(v).trim() === '' || !Number.isInteger(Number(v)) || Number(v) < 0)) return 'יש למלא מספרים שלמים שאינם שליליים.'
  if (Number(maximum) < 1 || Number(minimum) > Number(target) || Number(target) > Number(maximum)) return 'המינימום חייב להיות עד היעד, והיעד עד המקסימום. המקסימום חייב להיות לפחות 1.'
  return ''
}
