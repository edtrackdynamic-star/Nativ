const israelFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function formatIsraelDateTime(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso))
}

export function toIsraelDateTimeInput(iso?: string): string {
  if (!iso) return ''
  const parts = Object.fromEntries(israelFormatter.formatToParts(new Date(iso)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function fromIsraelDateTimeInput(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u)
  if (!match) throw new Error('יש להזין תאריך ושעה תקינים')
  const [, year, month, day, hour, minute] = match.map(Number)
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  for (const offsetHours of [3, 2]) {
    const candidate = new Date(localAsUtc - offsetHours * 60 * 60 * 1000)
    if (toIsraelDateTimeInput(candidate.toISOString()) === value) return candidate.toISOString()
  }
  throw new Error('השעה שנבחרה אינה קיימת בשעון ישראל. בחרו שעה אחרת.')
}
