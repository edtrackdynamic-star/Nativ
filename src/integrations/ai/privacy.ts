const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const phonePattern = /(?<!\d)(?:\+?972[-\s]?)?(?:0?5\d[-\s]?)?\d{3}[-\s]?\d{4}(?!\d)/g

export interface RedactionResult {
  sanitizedText: string
  redactions: Array<'email' | 'phone'>
}

export function redactDirectIdentifiers(value: string): RedactionResult {
  const redactions: RedactionResult['redactions'] = []
  let sanitizedText = value.replace(emailPattern, () => {
    redactions.push('email')
    return '[פרט מזהה הוסר]'
  })
  sanitizedText = sanitizedText.replace(phonePattern, () => {
    redactions.push('phone')
    return '[פרט מזהה הוסר]'
  })
  return { sanitizedText, redactions }
}
