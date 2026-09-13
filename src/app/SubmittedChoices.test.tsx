import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SubmittedChoices } from './SubmittedChoices'

const clusters = [{ clusterId: 'c', label: 'מקבץ ראשון', requiredRankingCount: 2, courses: [
  { courseId: 'a', logicalCourseId: 'a', label: 'תיאטרון' },
  { courseId: 'b', logicalCourseId: 'b', label: 'עיצוב' },
] }]
const preferences = [{ clusterId: 'c', rankings: [{ courseId: 'b', rank: 2 }, { courseId: 'a', rank: 1 }], rationale: 'אני אוהב להופיע' }]

describe('submitted choices confirmation', () => {
  it('shows the submitted ranking and an edit action while responses are open', () => {
    const html = renderToStaticMarkup(<SubmittedChoices clusters={clusters} preferences={preferences} canEdit onEdit={() => undefined} />)
    expect(html).toContain('תודה שבחרת!')
    expect(html.indexOf('תיאטרון')).toBeLessThan(html.indexOf('עיצוב'))
    expect(html).toContain('עריכת הבחירות')
    expect(html).toContain('אני אוהב להופיע')
  })

  it('explains closed editing and separates unsent draft changes', () => {
    const html = renderToStaticMarkup(<SubmittedChoices clusters={clusters} preferences={preferences} canEdit={false} onEdit={() => undefined} pendingDraft editClosedReason="השיבוץ החל, ולכן אי אפשר עוד לשנות את הבחירות." />)
    expect(html).not.toContain('עריכת הבחירות</button>')
    expect(html).toContain('השיבוץ החל')
    expect(html).toContain('יש שינויים שלא הוגשו')
  })

  it('labels generated demo choices without attributing them to the student', () => {
    const html = renderToStaticMarkup(<SubmittedChoices clusters={clusters} preferences={preferences} canEdit onEdit={() => undefined} generated />)
    expect(html).toContain('נתוני הדגמה')
    expect(html).toContain('לא מולאו על ידך')
    expect(html).not.toContain('תודה שבחרת!')
  })
})
