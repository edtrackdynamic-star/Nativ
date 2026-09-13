import { useState } from 'react'
import type { AppealRecord } from '../domain/workflow'

export function AppealDecisionControls({ appeal, readOnly, pending, onDecide }: { appeal: AppealRecord; readOnly: boolean; pending: boolean; onDecide: (outcome: 'approved' | 'rejected', reason: string) => void }) {
  const [reason, setReason] = useState('')
  const blocked = appeal.analysis?.constraintViolations.some(violation => !violation.includes('קיבולת המרבית'))
  return <div className="appeal-decision-controls">
    {appeal.recommendation && <p>המלצת הצוות: {{ approve: 'לאשר', reject: 'לדחות', more_information: 'נדרש מידע נוסף' }[appeal.recommendation.outcome]} — {appeal.recommendation.reason}</p>}
    <label>תשובה אישית לתלמיד/ה<textarea rows={3} maxLength={1000} value={reason} disabled={readOnly || pending} onChange={event => setReason(event.target.value)} placeholder="הסבירו בקצרה את ההחלטה. התשובה תוצג לתלמיד/ה." /></label>
    <div className="workspace-actions"><button type="button" className="primary-action" disabled={readOnly || pending || !reason.trim() || blocked} onClick={() => onDecide('approved', reason.trim())}>אישור כהצעה</button><button type="button" className="secondary-action" disabled={readOnly || pending || !reason.trim()} onClick={() => onDecide('rejected', reason.trim())}>דחיית הערעור</button></div>
    {!reason.trim() && <p>יש לכתוב תשובה אישית לפני קבלת החלטה.</p>}
    {blocked && <p role="alert">נמצאה הפרת אילוץ. בדקו את ניתוח ההשפעה לפני אישור.</p>}
  </div>
}
