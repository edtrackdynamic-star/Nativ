export type PreparationStageStatus = 'done' | 'active' | 'pending'

export interface PreparationStage {
  id: string
  title: string
  description: string
  status: PreparationStageStatus
  statusLabel: string
}

export const preparationStages: PreparationStage[] = [
  { id: '01', title: 'הגירה מחוץ ל־Dropbox', description: 'עותק מקומי מאומת נשמר לצד מקור גיבוי ללא שינוי.', status: 'done', statusLabel: 'הושלם' },
  { id: '02', title: 'תשתית קוד ותחום', description: 'מעטפת Web, חוזים, בדיקות ואמולטורים ללא נתוני אמת.', status: 'active', statusLabel: 'בתהליך' },
  { id: '03', title: 'חוזה ליבה עם EdTrack', description: 'יחובר לאחר סיום האופטימיזציה ואימות השדות וההרשאות.', status: 'pending', statusLabel: 'ממתין' },
  { id: '04', title: 'סביבת ענן ונתוני בדיקה', description: 'דורש אישור נפרד לפני יצירת משאבים או פריסה.', status: 'pending', statusLabel: 'טרם אושר' },
]
