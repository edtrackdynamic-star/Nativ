import { useEffect, useState } from 'react'
import { accessRoles, type RoleId } from '../domain/access'
import { listAccessUsers, setUserAccess, type AccessUserSummary } from './firebaseApi'

export function AccessManagerWorkspace() {
  const [users, setUsers] = useState<AccessUserSummary[]>([])
  const [message, setMessage] = useState('טוען משתמשים והרשאות…')
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  async function refresh() { const loaded = await listAccessUsers(); setUsers(loaded); setMessage(`${loaded.length} משתמשים משויכים לארגון.`) }
  useEffect(() => { let active = true; void listAccessUsers().then((loaded) => { if (active) { setUsers(loaded); setMessage(`${loaded.length} משתמשים משויכים לארגון.`) } }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'טעינת ההרשאות נכשלה') }); return () => { active = false } }, [])
  async function toggle(user: AccessUserSummary, role: RoleId) {
    const roles = user.roles.includes(role) ? user.roles.filter((entry) => entry !== role) : [...user.roles, role]
    try { setPendingUserId(user.uid); await setUserAccess(user.uid, roles, user.active); await refresh(); setMessage('התפקידים עודכנו. המשתמש יראה אותם בכניסה הבאה.') } catch (error) { setMessage(error instanceof Error ? error.message : 'עדכון ההרשאות נכשל') } finally { setPendingUserId(null) }
  }
  async function toggleActive(user: AccessUserSummary) {
    try { setPendingUserId(user.uid); await setUserAccess(user.uid, user.roles, !user.active); await refresh(); setMessage(user.active ? 'הגישה הושעתה.' : 'הגישה הופעלה.') } catch (error) { setMessage(error instanceof Error ? error.message : 'עדכון הגישה נכשל') } finally { setPendingUserId(null) }
  }
  return <section className="workspace-card" aria-labelledby="access-title"><div className="workspace-heading"><div><span className="eyebrow">משתמשים ותפקידים</span><h2 id="access-title">איוש תפקידים</h2></div></div><p className="workspace-message" aria-live="polite">{message}</p><div className="access-table">{users.map((user) => <article key={user.uid}><div><strong>{user.displayName ?? user.email ?? 'משתמש'}</strong><small>{user.email}</small></div><div className="role-checks"><label><input type="checkbox" checked={user.active} disabled={pendingUserId === user.uid} onChange={() => void toggleActive(user)} />גישה פעילה</label>{accessRoles.map((role) => <label key={role.id}><input type="checkbox" checked={user.roles.includes(role.id)} disabled={pendingUserId === user.uid} onChange={() => void toggle(user, role.id)} />{role.label}</label>)}</div></article>)}</div></section>
}
