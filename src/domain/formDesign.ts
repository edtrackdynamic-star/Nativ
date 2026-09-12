export interface FormDesign {
  title: string; introduction: string; instructions: string; documentUrl: string; coverUrl: string;
  documentStoragePath: string; documentName: string; documentLinkVisible: boolean; theme: 'blue' | 'teal' | 'purple'; layout: 'cards' | 'list'; submitLabel: string;
}
export const defaultFormDesign: FormDesign = { title: 'טופס הבחירה שלי', introduction: 'לפני שתתחילו לבחור, קראו בעיון את תקצירי הקורסים.\n\nבכל מקבץ דרגו את מספר הקורסים הנדרש לפי סדר העדיפות שלכם, החל מהקורס המועדף ביותר (דירוג 1). הדירוג עוזר לנו להתחשב בבחירות שלכם ככל האפשר, גם כשיש ביקוש רב לקורס מסוים.\n\nאם תרצו, תוכלו להוסיף הסבר קצר על מה שמסקרן אתכם בבחירות שלכם ומה הייתם רוצים ללמוד. ההסבר הוא רשות.', instructions: '', documentUrl: '', documentStoragePath: '', documentName: '', documentLinkVisible: false, coverUrl: '', theme: 'blue', layout: 'cards', submitLabel: 'הגשת הבחירות' }
export function safeCycleDocumentPath(value: unknown): string {
  if (!value) return ''
  if (typeof value !== 'string' || !/^organizations\/[a-z0-9][a-z0-9-]{2,64}\/nativCycles\/cycle-[a-f0-9-]+\/source-documents\/[a-f0-9-]+\.docx$/u.test(value)) throw new Error('מסמך Word אינו תקין')
  return value
}
export function safeLink(value: unknown, docsOnly = false): string {
  if (!value) return ''
  if (typeof value !== 'string' || value.length > 2048) throw new Error('הקישור אינו תקין')
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (docsOnly && (url.hostname !== 'docs.google.com' || !url.pathname.startsWith('/document/')))) throw new Error()
    return url.href
  } catch { throw new Error(docsOnly ? 'יש להזין קישור HTTPS למסמך Google Docs' : 'יש להזין קישור HTTPS תקין') }
}
export function parseFormDesign(value: unknown): FormDesign {
  const data = (value && typeof value === 'object' ? value : {}) as Partial<FormDesign>
  const text = (key: keyof FormDesign, limit: number) => {
    const value = data[key] ?? defaultFormDesign[key]
    if (typeof value !== 'string' || value.length > limit) throw new Error('טקסט הטופס ארוך מדי או אינו תקין')
    return value.trim()
  }
  if (data.theme && !['blue','teal','purple'].includes(data.theme)) throw new Error('יש לבחור צבע מתוך האפשרויות')
  if (data.layout && !['cards','list'].includes(data.layout)) throw new Error('יש לבחור פריסה תקינה')
  if (data.documentLinkVisible !== undefined && typeof data.documentLinkVisible !== 'boolean') throw new Error('יש לבחור אם להציג את קישור המסמך')
  const documentUrl = safeLink(data.documentUrl,true)
  const documentStoragePath = safeCycleDocumentPath(data.documentStoragePath)
  if (documentUrl && documentStoragePath) throw new Error('יש לבחור מסמך מקור אחד בלבד')
  return { title: text('title',150) || defaultFormDesign.title, introduction: text('introduction',4000), instructions: text('instructions',2000), documentUrl, documentStoragePath, documentName: text('documentName',200), documentLinkVisible: data.documentLinkVisible ?? Boolean(documentUrl || documentStoragePath), coverUrl: safeLink(data.coverUrl), theme: data.theme ?? 'blue', layout: data.layout ?? 'cards', submitLabel: text('submitLabel',60) || defaultFormDesign.submitLabel }
}
