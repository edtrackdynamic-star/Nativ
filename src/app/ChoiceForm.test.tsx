import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChoiceForm } from './ChoiceForm'

function render(schoolLogo?: string) {
  return renderToStaticMarkup(<ChoiceForm clusters={[]} preferences={[]} onChange={() => undefined} onSubmit={() => undefined} schoolName="בית ספר לדוגמה" schoolLogo={schoolLogo} />)
}

describe('ChoiceForm branding and introduction', () => {
  it('shows the school name when no logo is available and keeps the approved introduction', () => {
    const html = render()
    expect(html).toContain('בית ספר לדוגמה')
    expect(html).toContain('תינתן עדיפות להעדפות המלוות בהסבר אישי ומנומק')
    expect(html).not.toContain('choice-form-school-logo')
  })

  it('uses the school logo in the same form header when available', () => {
    const html = render('https://example.org/school-logo.png')
    expect(html).toContain('class="choice-form-school-logo"')
    expect(html).toContain('src="https://example.org/school-logo.png"')
  })
})
