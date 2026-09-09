/** Academic years roll over on 1 September, using the school timezone. */
export function currentSchoolYearStart(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Jerusalem',year:'numeric',month:'numeric'}).formatToParts(now)
  const year = Number(parts.find(p=>p.type==='year')!.value)
  return year - (Number(parts.find(p=>p.type==='month')!.value) < 9 ? 1 : 0)
}
export function schoolYearId(start: number): string { return `${start}-${start+1}` }
export function schoolYearStart(id: string): number | null {
  const match = /^(\d{4})-(\d{4})$/.exec(id)
  return match && Number(match[2]) === Number(match[1])+1 ? Number(match[1]) : null
}
function hebrewYear(year: number): string {
  let value=year%1000, letters=''
  for (const [amount,letter] of [[400,'ת'],[300,'ש'],[200,'ר'],[100,'ק'],[90,'צ'],[80,'פ'],[70,'ע'],[60,'ס'],[50,'נ'],[40,'מ'],[30,'ל'],[20,'כ']] as const) {
    while(value>=amount){letters+=letter;value-=amount}
  }
  if(value===15 || value===16){letters+='ט';value-=9}
  for(const [amount,letter] of [[10,'י'],[9,'ט'],[8,'ח'],[7,'ז'],[6,'ו'],[5,'ה'],[4,'ד'],[3,'ג'],[2,'ב'],[1,'א']] as const){if(value>=amount){letters+=letter;value-=amount}}
  return letters.length===1 ? letters+'׳' : letters.slice(0,-1)+'״'+letters.slice(-1)
}
export function schoolYearLabel(id: string): string {
  const start=schoolYearStart(id)
  return start===null ? id : `${hebrewYear(start+3761)} · \u2066${start}–${start+1}\u2069`
}
export function schoolYearOptions(now = new Date()): Array<{id:string;label:string}> {
  const current=currentSchoolYearStart(now)
  return [current-1,current,current+1].map(start=>({id:schoolYearId(start),label:schoolYearLabel(schoolYearId(start))}))
}
export function isCurrentYearWindow(id:string, now = new Date()): boolean {
  const start=schoolYearStart(id), current=currentSchoolYearStart(now)
  return start!==null && Math.abs(start-current)<=1
}
export function preferredCycleId(cycles: Array<{id:string;schoolYear:string}>, now = new Date()): string | null {
  const current=schoolYearId(currentSchoolYearStart(now))
  return cycles.find(c=>c.schoolYear===current)?.id ?? cycles.find(c=>isCurrentYearWindow(c.schoolYear,now))?.id ?? null
}
