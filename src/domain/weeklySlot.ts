export interface WeeklySlot { weekday: number; periodStart: number; periodEnd: number; timeStart?: string; timeEnd?: string }

export const weekdayNames = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'] as const

export function parseWeeklySlot(value: unknown): WeeklySlot | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') throw new Error('יום ושעת הקורס אינם תקינים')
  const slot = value as Partial<WeeklySlot>
  if (!Number.isInteger(slot.weekday) || slot.weekday! < 0 || slot.weekday! > 6 || !Number.isInteger(slot.periodStart) || !Number.isInteger(slot.periodEnd) || slot.periodStart! < 1 || slot.periodEnd! < slot.periodStart! || slot.periodEnd! > 20) throw new Error('יש לבחור יום ושעות לימוד תקינים למקבץ')
  for (const time of [slot.timeStart, slot.timeEnd]) if (time !== undefined && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(time))) throw new Error('שעות השעון אינן תקינות')
  if (Boolean(slot.timeStart) !== Boolean(slot.timeEnd) || (slot.timeStart && slot.timeEnd && slot.timeEnd <= slot.timeStart)) throw new Error('יש להזין שעת התחלה וסיום תקינות')
  return { weekday: slot.weekday!, periodStart: slot.periodStart!, periodEnd: slot.periodEnd!, ...(slot.timeStart ? { timeStart: slot.timeStart, timeEnd: slot.timeEnd } : {}) }
}

export function weeklySlotLabel(slot?: WeeklySlot): string {
  if (!slot) return 'מועד המפגש טרם הוגדר'
  const periods = slot.periodStart === slot.periodEnd ? `שעה ${slot.periodStart}` : `שעות ${slot.periodStart}–${slot.periodEnd}`
  return `${weekdayNames[slot.weekday]}, ${periods}${slot.timeStart ? ` · ${slot.timeStart}–${slot.timeEnd}` : ''}`
}

export function todayWeekdayIsrael(now = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Jerusalem' }).format(now)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}
