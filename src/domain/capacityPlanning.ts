export function proposeCapacities(students: number, flexibility: number, courses: Array<{ minimum: number; limit?: number }>) {
  if (!Number.isSafeInteger(students) || students < 1) throw new Error('לא נמצאו תלמידים משתתפים. בדקו את הכיתות במקבץ.')
  if (!Number.isSafeInteger(flexibility) || flexibility < 0) throw new Error('הגמישות חייבת להיות מספר שלם שאינו שלילי.')
  if (!courses.length) throw new Error('יש להוסיף קורס אחד לפחות.')
  for (const course of courses) {
    if (!Number.isSafeInteger(course.minimum) || course.minimum < 0 || (course.limit !== undefined && (!Number.isSafeInteger(course.limit) || course.limit < 1 || course.limit < course.minimum))) throw new Error('בדקו שהמינימום אינו שלילי ושהמכסה חיובית ואינה נמוכה ממנו.')
  }
  const targets = courses.map(c=>c.minimum)
  let remaining = students - targets.reduce((a,b)=>a+b,0)
  if (remaining < 0) throw new Error('סכום המינימום לפתיחה גדול ממספר התלמידים המשתתפים.')
  // Water filling: capped courses leave their remaining share to the others.
  while (remaining > 0) {
    const eligible = courses.map((c,i)=>({i,level:targets[i],limit:c.limit??students})).filter(c=>c.level<c.limit)
    if (!eligible.length) break
    const lowest = Math.min(...eligible.map(c=>c.level))
    const group = eligible.filter(c=>c.level===lowest)
    const nextLevel = Math.min(...eligible.filter(c=>c.level>lowest).map(c=>c.level), ...group.map(c=>c.limit))
    const step = Math.min(nextLevel-lowest, Math.floor(remaining/group.length))
    if (step > 0) { for (const c of group) targets[c.i]+=step; remaining-=step*group.length }
    else { for (const c of group) { if (!remaining) break; targets[c.i]++; remaining-- } }
  }
  const capacities = courses.map((c,i)=>({minimum:c.minimum,target:targets[i],maximum:Math.max(1,Math.min(c.limit??students,targets[i]+flexibility))}))
  return { capacities, unplaced: remaining, totalSeats: capacities.reduce((sum,c)=>sum+c.maximum,0) }
}
