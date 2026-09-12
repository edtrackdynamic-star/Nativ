import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChoiceForm } from './ChoiceForm'

function render(schoolLogo?: string) {
  return renderToStaticMarkup(<ChoiceForm clusters={[]} preferences={[]} onChange={() => undefined} onSubmit={() => undefined} schoolName="בית ספר לדוגמה" schoolLogo={schoolLogo} />)
}

describe('ChoiceForm branding and introduction', () => {
  it('shows the school name and describes the explanation as optional', () => {
    const html = render()
    expect(html).toContain('בית ספר לדוגמה')
    expect(html).toContain('ההסבר הוא רשות')
    expect(html).not.toContain('choice-form-school-logo')
  })

  it('uses the school logo in the same form header when available', () => {
    const html = render('https://example.org/school-logo.png')
    expect(html).toContain('class="choice-form-school-logo"')
    expect(html).toContain('src="https://example.org/school-logo.png"')
  })
})
