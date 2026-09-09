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
      <NativMvp />
    </main>
  </div>
}

export default App
