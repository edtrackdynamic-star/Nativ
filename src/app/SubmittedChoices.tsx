import type { ClusterPreference, ClusterSnapshot } from '../domain/preferences'
import { SchoolBrand } from '../components/SchoolBrand'

export function SubmittedChoices({ clusters, preferences, submittedAt, canEdit, onEdit, editClosedReason, pendingDraft, schoolName, schoolLogo }: {
  clusters: ClusterSnapshot[]
  preferences: ClusterPreference[]
  submittedAt?: string
  canEdit: boolean
  onEdit: () => void
  editClosedReason?: string
  pendingDraft?: boolean
  schoolName?: string
  schoolLogo?: string
}) {
  return <section className="submitted-choices" aria-labelledby="submitted-choices-title">
    {schoolName && <SchoolBrand className="submitted-school-brand" imageClassName="submitted-school-logo" name={schoolName} src={schoolLogo} />}
    <div className="submitted-choices-heading">
      <div><span className="eyebrow">הבחירות שלך הוגשו</span><h2 id="submitted-choices-title">תודה שבחרת!</h2></div>
      <span className="status-pill">הוגש</span>
    </div>
    <p>הבחירות שלך נקלטו. השיבוץ הסופי יופיע כאן לאחר פרסומו.</p>
    {submittedAt && <p className="submitted-at">הוגש בתאריך {new Date(submittedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' })}</p>}
    {pendingDraft && <p className="choice-pending-draft" role="status">יש שינויים שלא הוגשו. הבחירות שמוצגות כאן הן הבחירות שהוגשו בפועל.</p>}
    <div className="submitted-choices-list">{clusters.map((cluster) => {
      const preference = preferences.find((entry) => entry.clusterId === cluster.clusterId)
      return <article className="submitted-cluster" key={cluster.clusterId}>
        <h3>{cluster.label}</h3>
        <ol>{[...(preference?.rankings ?? [])].sort((a, b) => a.rank - b.rank).map((ranking) => <li key={ranking.rank}>{cluster.courses.find((course) => course.courseId === ranking.courseId)?.label ?? 'קורס שאינו זמין כעת'}</li>)}</ol>
        {preference?.rationale?.trim() && <p className="submitted-rationale"><strong>ההסבר שלך:</strong> {preference.rationale}</p>}
      </article>
    })}</div>
    {canEdit ? <button type="button" className="secondary-action" onClick={onEdit}>עריכת הבחירות</button> : <p className="choice-edit-closed" role="status">{editClosedReason}</p>}
  </section>
}
