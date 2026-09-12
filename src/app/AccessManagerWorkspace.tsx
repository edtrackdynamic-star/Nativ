import { useReadOnly } from './readOnly'
import { useConfirmAction } from './interaction'
import { useEffect, useState } from 'react'
import { accessRoles, type RoleId } from '../domain/access'
import { listAccessUsers, setUserAccess, type AccessUserSummary } from './firebaseApi'

export function AccessManagerWorkspace() {
  const readOnly = useReadOnly()
  const { confirm, confirmation } = useConfirmAction()
  const [tab, setTab] = useState<'staff' | 'students'>('staff')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AccessUserSummary[]>([])
  const [message, setMessage] = useState('טוען משתמשים והרשאות…')
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  async function refresh() { const loaded = await listAccessUsers(); setUsers(loaded); setMessage(`${loaded.length} משתמשים משויכים לארגון.`) }
  useEffect(() => { let active = true; void listAccessUsers().then((loaded) => { if (active) { setUsers(loaded); setMessage(`${loaded.length} משתמשים משויכים לארגון.`) } }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : 'טעינת ההרשאות נכשלה') }); return () => { active = false } }, [])
  async function toggle(user: AccessUserSummary, role: RoleId) {
    if (pendingUserId || user.coreRole === 'student') return
    const manageable: RoleId[] = user.roles.filter((entry) => entry !== 'course_instructor')
    const roles = manageable.includes(role) ? manageable.filter((entry) => entry !== role) : [...manageable, role]
    try { setPendingUserId(user.uid); await setUserAccess(user.uid, roles, user.active); await refresh(); setMessage('התפקידים עודכנו. המשתמש יראה אותם בכניסה הבאה.') } catch (error) { setMessage(error instanceof Error ? error.message : 'עדכון ההרשאות נכשל') } finally { setPendingUserId(null) }
  }
  async function toggleActive(user: AccessUserSummary) {
    if (pendingUserId || !(await confirm(user.active ? 'להשעות את גישת המשתמש לנתיב?' : 'להפעיל את גישת המשתמש לנתיב?'))) return
    try { setPendingUserId(user.uid); await setUserAccess(user.uid, user.roles.filter(role => role !== 'course_instructor'), !user.active); await refresh(); setMessage(user.active ? 'הגישה הושעתה.' : 'הגישה הופעלה.') } catch (error) { setMessage(error instanceof Error ? error.message : 'עדכון הגישה נכשל') } finally { setPendingUserId(null) }
  }
  return <section className="workspace-card" aria-labelledby="access-title"><div className="workspace-heading"><div><span className="eyebrow">משתמשים ותפקידים</span><h2 id="access-title">איוש תפקידים</h2></div></div><p className="workspace-message" aria-live="polite">{message}</p><p>גישת מורה לקורס נקבעת לפי השיוך בהגדרות הטופס.</p><nav className="role-navigation" aria-label="סוג משתמש"><button aria-pressed={tab === 'staff'} className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>צוות</button><button aria-pressed={tab === 'students'} className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>תלמידים</button></nav><label className="search-field">חיפוש לפי שם או דוא״ל<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>{confirmation}<div className="access-table">{users.filter((user) => (tab === 'students' ? user.coreRole === 'student' : user.coreRole !== 'student') && [user.displayName, user.email].filter(Boolean).join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((user) => <article key={user.uid}><div><strong>{user.displayName ?? user.email ?? 'משתמש'}</strong><small>{user.email}</small></div><div className="role-checks"><label><input type="checkbox" checked={user.active} disabled={readOnly || pendingUserId !== null} onChange={() => void toggleActive(user)} />גישה פעילה</label>{user.coreRole !== 'student' && accessRoles.filter((role) => role.id !== 'student').map((role) => <label key={role.id}><input type="checkbox" checked={user.roles.includes(role.id)} disabled={readOnly || pendingUserId !== null || role.id === 'course_instructor'} onChange={() => void toggle(user, role.id)} />{role.id === 'course_instructor' ? 'מורה בקורס משויך' : role.label}</label>)}</div></article>)}</div></section>
}
