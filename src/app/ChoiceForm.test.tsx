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

describe('ChoiceForm submission guidance', () => {
  it('keeps the blocking reason next to the disabled submit action', () => {
    const html = renderToStaticMarkup(<ChoiceForm
      clusters={[{ clusterId: 'cluster-1', label: 'מקבץ ראשון', requiredRankingCount: 1, courses: [{ courseId: 'a', logicalCourseId: 'a', label: 'תיאטרון' }] }]}
      preferences={[{ clusterId: 'cluster-1', rankings: [{ rank: 1, courseId: '' }] }]}
      onChange={() => undefined} onSubmit={() => undefined} submitDisabled
      submitHint={<a href="#choice-cluster-cluster-1">מקבץ ראשון: חסרה בחירה.</a>}
    />)
    expect(html).toContain('id="choice-cluster-cluster-1"')
    expect(html).toContain('id="choice-submit-hint"')
    expect(html).toContain('aria-describedby="choice-submit-hint" disabled=""')
    expect(html).toContain('מקבץ ראשון: חסרה בחירה.')
  })
})
