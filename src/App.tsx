import './App.css'
import { preparationStages } from './app/preparationStages'
import { accessRoles } from './domain/access'
import { validateCourse } from './domain/catalog'
import { validatePreferenceSubmission } from './domain/preferences'
import { demoClusters, demoCourses, demoCycle, demoSubmission } from './demo/demoCycle'

const readinessCards = [
  { label: 'מעטפת המוצר', value: 'מוכנה לפיתוח', detail: 'יישום עצמאי, עברית ו־RTL, ללא תלות בממשק EdTrack.', tone: 'ready' },
  { label: 'ליבה משותפת', value: 'ממתינה לחוזה', detail: 'זהות, ארגון ותלמידים יתחברו דרך מתאם שרת מאושר.', tone: 'waiting' },
  { label: 'Gemini לנתיב', value: 'מבודד ומתוכנן', detail: 'פרויקט Cloud נפרד, מזהים אטומים ופלט המאושר בידי רכז.', tone: 'planned' },
] as const

function RouteMark() {
  return (
    <svg className="route-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M10 36V20c0-6 4-10 10-10h2c7 0 8 7 14 7h2" />
      <path d="M22 10c7 0 8 12 16 12" />
      <circle cx="10" cy="38" r="3" />
      <circle cx="39" cy="17" r="3" />
      <circle cx="39" cy="22" r="3" />
    </svg>
  )
}

function App() {
  const demoIssues = [
    ...demoCourses.flatMap(validateCourse),
    ...validatePreferenceSubmission(demoSubmission, demoCycle),
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="נתיב — לדף הראשי">
          <span className="brand-mark"><RouteMark /></span>
          <span><strong>נתיב</strong><small>בחירה ושיבוץ קורסים</small></span>
        </a>
        <span className="environment-badge">סביבת הכנה מקומית</span>
      </header>

      <main id="main">
        <section className="hero-panel" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow">תשתית פיתוח ראשונית</span>
            <h1 id="hero-title">כל תהליך הבחירה והשיבוץ, בנתיב אחד ברור.</h1>
            <p>המערכת נבנית כמוצר עצמאי עם הרשאות מדויקות, היסטוריה מלאה וחיבור מבוקר בלבד לליבה הארגונית של EdTrack.</p>
          </div>
          <div className="hero-visual" aria-label="המחשה של מסלול הבחירה והשיבוץ">
            <span className="route-node active">בחירה</span><span className="route-line" />
            <span className="route-node">בדיקה</span><span className="route-line" />
            <span className="route-node">שיבוץ</span>
          </div>
        </section>

        <section className="section" aria-labelledby="readiness-title">
          <div className="section-heading">
            <div><span className="eyebrow">תמונת מצב</span><h2 id="readiness-title">מוכנים להתקדם בלי לגעת במערכת הפעילה</h2></div>
            <span className="status-pill"><i /> ללא חיבור לנתוני אמת</span>
          </div>
          <div className="card-grid">
            {readinessCards.map((card) => (
              <article className={`readiness-card ${card.tone}`} key={card.label}>
                <span>{card.label}</span><strong>{card.value}</strong><p>{card.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="domain-summary" aria-labelledby="domain-title">
          <div>
            <span className="eyebrow">מודל תחום פעיל</span>
            <h2 id="domain-title">מחזור הדגמה: {demoCycle.schoolYear} · {demoCycle.termLabel}</h2>
            <p>הנתונים מקומיים ואנונימיים. הם משמשים לבדיקת כללי המחזור והטופס בלבד.</p>
          </div>
          <dl>
            <div><dt>מצב</dt><dd>בחירה פתוחה</dd></div>
            <div><dt>מקבצים</dt><dd>{demoClusters.length}</dd></div>
            <div><dt>קורסים</dt><dd>{demoCourses.length}</dd></div>
            <div><dt>בדיקות תקינות</dt><dd className={demoIssues.length ? 'has-issues' : 'is-valid'}>{demoIssues.length ? `${demoIssues.length} לבדיקה` : 'תקין'}</dd></div>
          </dl>
        </section>

        <section className="split-layout">
          <article className="panel" aria-labelledby="stages-title">
            <div className="section-heading compact"><div><span className="eyebrow">מפת הדרך</span><h2 id="stages-title">שלבי ההכנה</h2></div></div>
            <ol className="stage-list">
              {preparationStages.map((stage) => (
                <li key={stage.id}>
                  <span className={`stage-index ${stage.status}`}>{stage.id}</span>
                  <div><strong>{stage.title}</strong><p>{stage.description}</p></div>
                  <span className={`stage-status ${stage.status}`}>{stage.statusLabel}</span>
                </li>
              ))}
            </ol>
          </article>

          <article className="panel" aria-labelledby="roles-title">
            <div className="section-heading compact"><div><span className="eyebrow">הרשאות</span><h2 id="roles-title">גישה לפי אחריות</h2></div></div>
            <div className="role-list">
              {accessRoles.map((role) => (
                <div className="role-row" key={role.id}>
                  <span className="role-icon" aria-hidden="true">{role.symbol}</span>
                  <div><strong>{role.label}</strong><p>{role.summary}</p></div>
                </div>
              ))}
            </div>
            <p className="privacy-note">מנהל גישה אינו רואה נימוקי תלמידים או ערעורים ללא תפקיד מקצועי נוסף.</p>
          </article>
        </section>
      </main>
    </div>
  )
}

export default App
