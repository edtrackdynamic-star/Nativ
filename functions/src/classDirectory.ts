import { coreFirestore } from './firebase'
export async function eligibleClasses(organizationId: string): Promise<Array<{ id: string; name: string }>> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') return [{ id: 'class-demo-7a', name: 'ז׳1' }, { id: 'class-demo-7b', name: 'ז׳2' }]
  const snapshot = await coreFirestore.collection(`organizations/${organizationId}/classes`).where('active', '==', true).get()
  return snapshot.docs.map(doc => ({ id: doc.id, name: String(doc.data().name ?? doc.id) })).sort((a, b) => a.name.localeCompare(b.name, 'he'))
}
