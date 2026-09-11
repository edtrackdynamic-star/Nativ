export interface FormDesign {
  title: string; introduction: string; instructions: string; documentUrl: string; coverUrl: string;
  documentLinkVisible: boolean; theme: 'blue' | 'teal' | 'purple'; layout: 'cards' | 'list'; submitLabel: string;
}
export const defaultFormDesign: FormDesign = { title: 'טופס הבחירה שלי', introduction: '', instructions: 'קראו על הקורסים ודרגו את ההעדפות שלכם בכל מקבץ.', documentUrl: '', documentLinkVisible: false, coverUrl: '', theme: 'blue', layout: 'cards', submitLabel: 'הגשת הבחירות' }
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
  return { title: text('title',150) || defaultFormDesign.title, introduction: text('introduction',4000), instructions: text('instructions',2000), documentUrl: safeLink(data.documentUrl,true), documentLinkVisible: data.documentLinkVisible ?? Boolean(data.documentUrl), coverUrl: safeLink(data.coverUrl), theme: data.theme ?? 'blue', layout: data.layout ?? 'cards', submitLabel: text('submitLabel',60) || defaultFormDesign.submitLabel }
}
