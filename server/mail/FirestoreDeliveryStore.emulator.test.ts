import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { afterAll, describe, expect, it } from 'vitest'
import { FirestoreDeliveryStore } from './FirestoreDeliveryStore'
import { deliverOnce } from './delivery'

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required')
const app = initializeApp({ projectId: 'demo-nativ-local' }, 'delivery-claim-tests')
const db = getFirestore(app)
afterAll(() => deleteApp(app))

describe('transactional delivery receipts', () => {
  it('allows exactly one SMTP invocation across concurrent transactions', async () => {
    const store = new FirestoreDeliveryStore(db, 'organizations/mail-test/receipts')
    const id = `concurrent-${Date.now()}`; let count = 0
    await Promise.all(Array.from({ length: 5 }, () => deliverOnce(store, id, async () => { count++ })))
    expect(count).toBe(1)
    expect((await db.doc(`organizations/mail-test/receipts/${id}`).get()).data()?.status).toBe('sent')
  })
  it('retains uncertain state without repeating SMTP', async () => {
    const store = new FirestoreDeliveryStore(db, 'organizations/mail-test/receipts')
    const id = `uncertain-${Date.now()}`; let count = 0
    const send = async () => { count++; throw new Error('ambiguous') }
    await deliverOnce(store, id, send); await deliverOnce(store, id, send)
    expect(count).toBe(1)
    expect((await db.doc(`organizations/mail-test/receipts/${id}`).get()).data()?.status).toBe('delivery_unknown')
  })
})
