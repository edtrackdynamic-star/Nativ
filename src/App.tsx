import './App.css'
import { NativMvp } from './app/NativMvp'

function App() {
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#main" aria-label="נתיב — מערכת שיבוץ קורסי בחירה">
        <span className="brand-mark"><img src="/nativ-mark.png" alt="" /></span>
        <span><strong>נתיב</strong><small>מערכת שיבוץ קורסי בחירה</small><span className="brand-byline">מבית יובל פלטין · חינוך דינמי</span></span>
      </a>
    </header>
    <main id="main">
      <section className="hero-panel" aria-labelledby="hero-title">
        <div className="hero-copy"><span className="eyebrow">מערכת שיבוץ קורסי בחירה</span><h1 id="hero-title">נתיב — הדרך הנכונה לבחור</h1><p>כל תהליך הבחירה והשיבוץ במקום אחד, ברור ונגיש.</p><small className="hero-byline">מבית יובל פלטין · חינוך דינמי</small></div>
        <div className="hero-visual" aria-label="שלבי התהליך"><span className="route-node active">בחירה</span><span className="route-line" /><span className="route-node">בדיקה</span><span className="route-line" /><span className="route-node">שיבוץ</span></div>
      </section>
      <NativMvp />
    </main>
  </div>
}

export default App
