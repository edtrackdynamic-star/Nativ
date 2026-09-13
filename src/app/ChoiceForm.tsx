import type { ClusterPreference, ClusterSnapshot } from '../domain/preferences'
import { defaultFormDesign, type FormDesign } from '../domain/formDesign'
import { SchoolBrand } from '../components/SchoolBrand'
import type { ReactNode } from 'react'

export function ChoiceForm({ clusters, design = defaultFormDesign, preferences, onChange, onSubmit, onSaveDraft, onOpenDocument, schoolName, schoolLogo, disabled = false, saveDisabled = false, submitDisabled = false, submitHint, preview = false }: {
  clusters: ClusterSnapshot[]; design?: FormDesign; preferences: ClusterPreference[];
  onChange: (value: ClusterPreference[]) => void; onSubmit: () => void; onSaveDraft?: () => void; onOpenDocument?: () => void; schoolName?: string; schoolLogo?: string; disabled?: boolean; saveDisabled?: boolean; submitDisabled?: boolean; submitHint?: ReactNode; preview?: boolean;
}) {
  const form = { ...defaultFormDesign, ...design }
  const documentAvailable = form.documentLinkVisible && Boolean(form.documentUrl || (form.documentStoragePath && onOpenDocument))
  const documentLink = form.documentUrl
    ? <a href={form.documentUrl} target="_blank" rel="noopener noreferrer">תקצירי הקורסים</a>
    : <button type="button" className="inline-document-link" onClick={onOpenDocument}>תקצירי הקורסים</button>
  const introLinkLabel = 'תקצירי הקורסים'
  const introduction = !documentAvailable && form.introduction === defaultFormDesign.introduction
    ? form.introduction.replace('לפני שתתחילו לבחור, קראו בעיון את תקצירי הקורסים.\n\n', '')
    : form.introduction
  const introLinkIndex = introduction.indexOf(introLinkLabel)
  function update(id: string, patch: Partial<ClusterPreference>) { onChange(preferences.map(p => p.clusterId === id ? { ...p, ...patch } : p)) }
  return <form className={`choice-form theme-${form.theme} layout-${form.layout}`} onSubmit={event => { event.preventDefault(); onSubmit() }}>
    <header className="choice-form-header">
      {schoolName && <SchoolBrand className="choice-form-school-brand" imageClassName="choice-form-school-logo" name={schoolName} src={schoolLogo} />}
      {form.coverUrl && <img className="form-cover" src={form.coverUrl} alt="" />}
      <h2>{form.title}</h2>{introduction && <p className="formatted-text">{documentAvailable && introLinkIndex >= 0 ? <>{introduction.slice(0,introLinkIndex)}{documentLink}{introduction.slice(introLinkIndex+introLinkLabel.length)}</> : introduction}</p>}
      {documentAvailable && introLinkIndex < 0 && documentLink}
      {form.instructions && <p className="formatted-text">{form.instructions}</p>}
    </header>
    <fieldset className="workspace-boundary" disabled={disabled}><div className="choice-clusters">{clusters.map(cluster => {
      const preference = preferences.find(p => p.clusterId === cluster.clusterId)
      return <section className="choice-cluster" id={`choice-cluster-${cluster.clusterId}`} key={cluster.clusterId}>
        <h3>{cluster.label}</h3>{cluster.description && <p className="formatted-text">{cluster.description}</p>}
        <div className="course-options">{cluster.courses.map(course => <article className="course-option" key={course.courseId}>
          {course.imageUrl && <img src={course.imageUrl} alt="" />}
          <h4>{course.label}</h4>{course.instructorNames?.length ? <p>בהנחיית {course.instructorNames.join(' ו')}</p> : null}
          {course.description && <details className="course-description"><summary>תיאור הקורס</summary><p className="formatted-text">{course.description}</p></details>}
          {course.documentUrl && <a href={course.documentUrl} target="_blank" rel="noopener noreferrer">לתכני הקורס ↗</a>}
        </article>)}</div>
        <p>{cluster.requiredRankingCount===1?'בחרו קורס אחד במקבץ.':`דרגו ${cluster.requiredRankingCount} קורסים, מההעדפה הראשונה ואילך.`}</p>
        <div className="choice-ranking-grid">{Array.from({length:cluster.requiredRankingCount},(_,index) => index+1).map(rank => <label className="field-row" key={rank}><span>בחירה {rank}</span><select required value={preference?.rankings.find(r=>r.rank===rank)?.courseId ?? ''} onChange={event => update(cluster.clusterId, {rankings: preference!.rankings.map(r=>r.rank===rank ? {...r,courseId:event.target.value}:r)})}>
          <option value="">בחרו קורס</option>{cluster.courses.map(course => <option value={course.courseId} key={course.courseId} disabled={preference?.rankings.some(r=>r.rank!==rank && r.courseId===course.courseId)}>{course.label}</option>)}</select></label>)}
        </div>
        {cluster.rationaleMode !== 'hidden' && <label className="rationale-field">{cluster.rationaleMode === 'required' ? 'הסבר לבחירה (חובה)' : 'רוצה לספר לנו על הבחירה? (רשות)'}<textarea rows={3} maxLength={4000} required={cluster.rationaleMode==='required'} value={preference?.rationale ?? ''} onChange={event => update(cluster.clusterId,{rationale:event.target.value})} /></label>}
      </section>
    })}</div>{submitHint && <div className="choice-submit-hint" id="choice-submit-hint" role="status" aria-live="polite">{submitHint}</div>}<div className="choice-form-actions">{onSaveDraft && <button className="secondary-action" type="button" disabled={saveDisabled} onClick={onSaveDraft}>שמירת טיוטה</button>}<button className="primary-action form-submit" type="submit" aria-describedby={submitHint ? 'choice-submit-hint' : undefined} disabled={submitDisabled}>{preview ? 'התנסות בהגשה' : form.submitLabel}</button></div></fieldset>
  </form>
}
