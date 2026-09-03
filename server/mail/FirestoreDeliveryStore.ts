import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import type { DeliveryStore } from './delivery'

export class FirestoreDeliveryStore implements DeliveryStore {
  constructor(private readonly db: Firestore, private readonly parentPath: string) {}
  async claim(id: string): Promise<boolean> {
    const reference = this.db.doc(`${this.parentPath}/${id}`)
    return this.db.runTransaction(async (transaction) => {
      if ((await transaction.get(reference)).exists) return false
      transaction.create(reference, { status: 'sending', startedAt: FieldValue.serverTimestamp() })
      return true
    })
  }
  async finish(id: string, status: 'sent' | 'delivery_unknown'): Promise<void> {
    await this.db.doc(`${this.parentPath}/${id}`).update({ status, completedAt: FieldValue.serverTimestamp() })
  }
}
