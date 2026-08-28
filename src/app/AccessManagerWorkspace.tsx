import { useEffect, useState } from 'react'
import { accessRoles, type RoleId } from '../domain/access'
import { listAccessUsers, setUserAccess, type AccessUserSummary } from './firebaseApi'

export function AccessManagerWorkspace() {
  const [users, setUsers] = useState<AccessUserSummary[]>([])
  const [message, setMessage] = useState('טוען משתמשים והרשאות…')
  async function refresh() { const loaded = await listAccessUsers(); setUsers(loaded); setMessage(`${loaded.length} משתמשים משויכים לארגון.`) }
  useEffect(() => { let active = true; void listAccessUsers().then((loaded) => { if (active) { setUsers(loaded); setMessage(`${loaded.length} משתמשים משויכים לארגון.`) } }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'טעינת ההרשאות נכשלה') }); return () => { active = false } }, [])
  async function toggle(user: AccessUserSummary, role: RoleId) {
    const roles = user.roles.includes(role) ? user.roles.filter((entry) => entry !== role) : [...user.roles, role]
    try { await setUserAccess(user.uid, roles, user.active); await refresh(); setMessage('התפקידים עודכנו. המשתמש יראה אותם בכניסה הבאה.') } catch (error) { setMessage(error instanceof Error ? error.message : 'עדכון ההרשאות נכשל') }
  }
  return <section className="workspace-card" aria-labelledby="access-title"><div className="workspace-heading"><div><span className="eyebrow">ניהול גישה בלבד</span><h2 id="access-title">איוש תפקידים</h2></div><span className="status-pill">ללא חשיפה מקצועית</span></div><p className="workspace-message" aria-live="polite">{message}</p><div className="access-table">{users.map((user) => <article key={user.uid}><div><strong>{user.displayName ?? user.email ?? user.uid}</strong><small>{user.email}</small></div><div className="role-checks">{accessRoles.map((role) => <label key={role.id}><input type="checkbox" checked={user.roles.includes(role.id)} onChange={() => void toggle(user, role.id)} />{role.label}</label>)}</div></article>)}</div><p className="privacy-note">מנהל גישה יכול לאייש כמה אנשים בכל תפקיד. התפקיד עצמו אינו מעניק גישה לנימוקי תלמידים, לשיבוצים או לערעורים; לכך נדרש תפקיד מקצועי נוסף.</p></section>
}
