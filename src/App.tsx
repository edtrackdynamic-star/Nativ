import './App.css'
import { NativMvp } from './app/NativMvp'

function RouteMark() {
  return <svg className="route-mark" viewBox="0 0 48 48" aria-hidden="true"><path d="M10 36V20c0-6 4-10 10-10h2c7 0 8 7 14 7h2" /><path d="M22 10c7 0 8 12 16 12" /><circle cx="10" cy="38" r="3" /><circle cx="39" cy="17" r="3" /><circle cx="39" cy="22" r="3" /></svg>
}

function App() {
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#main" aria-label="נתיב — הדרך הנכונה לבחור">
        <span className="brand-mark"><RouteMark /></span>
        <span><strong>נתיב</strong><small>הדרך הנכונה לבחור</small></span>
      </a>
    </header>
    <main id="main">
      <section className="hero-panel" aria-labelledby="hero-title">
        <div className="hero-copy"><span className="eyebrow">בחירה · שיבוץ · ערעורים</span><h1 id="hero-title">נתיב — הדרך הנכונה לבחור</h1><p>כל תהליך הבחירה והשיבוץ במקום אחד, ברור ונגיש.</p></div>
        <div className="hero-visual" aria-label="שלבי התהליך"><span className="route-node active">בחירה</span><span className="route-line" /><span className="route-node">בדיקה</span><span className="route-line" /><span className="route-node">שיבוץ</span></div>
      </section>
      <NativMvp />
    </main>
  </div>
}

export default App
