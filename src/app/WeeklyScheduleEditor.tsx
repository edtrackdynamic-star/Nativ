import { useEffect, useState } from 'react'
import type { CycleCatalogSnapshot } from '../domain/catalog'
import type { WeeklySlot } from '../domain/weeklySlot'
import { getCycleCatalog, setClusterWeeklySlots } from './firebaseApi'
import { WeeklySlotFields } from './WeeklySlotFields'

export function WeeklyScheduleEditor({ cycleId, readOnly = false }: { cycleId: string; readOnly?: boolean }) {
  const [catalog, setCatalog] = useState<CycleCatalogSnapshot | null>(null)
  const [slots, setSlots] = useState<Record<string, WeeklySlot | undefined>>({})
  const [message, setMessage] = useState('טוען מועדי קורסים…')
  const [pending, setPending] = useState(false)
  useEffect(() => { let active = true; void getCycleCatalog(cycleId).then(result => { if (!active) return; setCatalog(result.catalog); setSlots(Object.fromEntries((result.catalog?.clusters ?? []).map(cluster => [cluster.clusterId, cluster.weeklySlot]))); setMessage('') }).catch(() => { if (active) setMessage('טעינת המועדים נכשלה. רעננו את הדף ונסו שוב.') }); return () => { active = false } }, [cycleId])
  async function save() { if (!catalog || pending) return; try { setPending(true); const updated = await setClusterWeeklySlots(cycleId, catalog.version, catalog.clusters.map(cluster => ({ clusterId: cluster.clusterId, weeklySlot: slots[cluster.clusterId] }))); setCatalog(updated); setMessage('מועדי הקורסים נשמרו. הלוח השבועי יתעדכן לפי השיבוץ שפורסם.') } catch (error) { setMessage(error instanceof Error ? error.message : 'שמירת המועדים נכשלה. רעננו ונסו שוב.') } finally { setPending(false) } }
  return <section className="workflow-section"><h3>מועדי הקורסים השבועיים</h3><p>הגדירו יום ושעות לכל מקבץ. הזמנים משותפים לקורסים שבאותו מקבץ ומשמשים את לוחות המורים והתלמידים.</p>{catalog?.clusters.map(cluster => <div key={cluster.clusterId}><h4>{cluster.label}</h4><WeeklySlotFields value={slots[cluster.clusterId]} onChange={weeklySlot => setSlots(current => ({ ...current, [cluster.clusterId]: weeklySlot }))} disabled={readOnly || pending} /></div>)}<p role="status">{message}</p><button type="button" className="primary-action" disabled={readOnly || pending || !catalog} onClick={() => void save()}>שמירת מועדי הקורסים</button></section>
}
