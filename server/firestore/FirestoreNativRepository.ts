import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  Transaction,
} from 'firebase-admin/firestore'
import type { IdempotencyRecord, NativRepository, NativTransaction } from '../../src/application/repository'
import type { AssignmentCycle } from '../../src/domain/cycle'
import type { CycleCatalogSnapshot } from '../../src/domain/catalog'
import type { PreferenceSubmission } from '../../src/domain/preferences'
import { ConcurrentModificationError, type AuditEvent } from '../../src/domain/types'
import {
  auditEventDocumentPath,
  catalogSnapshotDocumentPath,
  cycleDocumentPath,
  idempotencyDocumentPath,
  organizationCollectionPath,
  submissionDocumentPath,
} from './paths'

function cleanForFirestore<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => cleanForFirestore(entry)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, cleanForFirestore(entry)]),
    ) as T
  }
  return value
}

function documentValue<T>(snapshot: DocumentSnapshot): T | null {
  return snapshot.exists ? structuredClone(snapshot.data() as T) : null
}

class FirestoreNativTransaction implements NativTransaction {
  private readonly transaction: Transaction
  private readonly firestore: Firestore
  private readonly snapshots = new Map<string, DocumentSnapshot>()
  private hasWrites = false

  constructor(transaction: Transaction, firestore: Firestore) {
    this.transaction = transaction
    this.firestore = firestore
  }

  async getCycle(organizationId: string, cycleId: string): Promise<AssignmentCycle | null> {
    return documentValue<AssignmentCycle>(await this.getDocument(this.firestore.doc(cycleDocumentPath(organizationId, cycleId))))
  }

  async listCycles(organizationId: string): Promise<AssignmentCycle[]> {
    const query = this.firestore.collection(organizationCollectionPath(organizationId, 'cycles')).orderBy('updatedAt', 'desc')
    const snapshots = await this.getQuery(query)
    return snapshots.map((snapshot) => snapshot.data() as AssignmentCycle)
  }

  async saveCycle(cycle: AssignmentCycle, expectedVersion: number): Promise<void> {
    const reference = this.firestore.doc(cycleDocumentPath(cycle.organizationId, cycle.id))
    const snapshot = await this.getDocument(reference)
    this.assertVersion(snapshot, expectedVersion, cycle.version)
    this.hasWrites = true
    if (expectedVersion === 0) this.transaction.create(reference, cleanForFirestore(cycle))
    else this.transaction.set(reference, cleanForFirestore(cycle))
  }

  async getCatalogSnapshot(organizationId: string, cycleId: string): Promise<CycleCatalogSnapshot | null> {
    const reference = this.firestore.doc(catalogSnapshotDocumentPath(organizationId, cycleId))
    return documentValue<CycleCatalogSnapshot>(await this.getDocument(reference))
  }

  async saveCatalogSnapshot(snapshot: CycleCatalogSnapshot, expectedVersion: number): Promise<void> {
    const reference = this.firestore.doc(catalogSnapshotDocumentPath(snapshot.organizationId, snapshot.cycleId))
    const current = await this.getDocument(reference)
    this.assertVersion(current, expectedVersion, snapshot.version)
    this.hasWrites = true
    if (expectedVersion === 0) this.transaction.create(reference, cleanForFirestore(snapshot))
    else this.transaction.set(reference, cleanForFirestore(snapshot))
  }

  async getSubmission(organizationId: string, submissionId: string): Promise<PreferenceSubmission | null> {
    return documentValue<PreferenceSubmission>(await this.getDocument(this.firestore.doc(submissionDocumentPath(organizationId, submissionId))))
  }

  async listSubmissions(organizationId: string, cycleId: string): Promise<PreferenceSubmission[]> {
    const query = this.firestore.collection(organizationCollectionPath(organizationId, 'submissions'))
      .where('cycleId', '==', cycleId)
      .orderBy('updatedAt', 'desc')
    const snapshots = await this.getQuery(query)
    return snapshots.map((snapshot) => snapshot.data() as PreferenceSubmission)
  }

  async saveSubmission(submission: PreferenceSubmission, expectedVersion: number): Promise<void> {
    const reference = this.firestore.doc(submissionDocumentPath(submission.organizationId, submission.id))
    const snapshot = await this.getDocument(reference)
    this.assertVersion(snapshot, expectedVersion, submission.version)
    this.hasWrites = true
    if (expectedVersion === 0) this.transaction.create(reference, cleanForFirestore(submission))
    else this.transaction.set(reference, cleanForFirestore(submission))
  }

  appendAuditEvent(event: AuditEvent): Promise<void> {
    this.hasWrites = true
    this.transaction.create(this.firestore.doc(auditEventDocumentPath(event.organizationId, event.id)), cleanForFirestore(event))
    return Promise.resolve()
  }

  async listAuditEvents(organizationId: string): Promise<AuditEvent[]> {
    const query = this.firestore.collection(organizationCollectionPath(organizationId, 'auditEvents')).orderBy('occurredAt', 'desc')
    const snapshots = await this.getQuery(query)
    return snapshots.map((snapshot) => snapshot.data() as AuditEvent)
  }

  async getIdempotencyRecord(organizationId: string, key: string): Promise<IdempotencyRecord | null> {
    return documentValue<IdempotencyRecord>(await this.getDocument(this.firestore.doc(idempotencyDocumentPath(organizationId, key))))
  }

  saveIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    this.hasWrites = true
    this.transaction.create(this.firestore.doc(idempotencyDocumentPath(record.organizationId, record.key)), cleanForFirestore(record))
    return Promise.resolve()
  }

  private async getDocument(reference: DocumentReference): Promise<DocumentSnapshot> {
    const cached = this.snapshots.get(reference.path)
    if (cached) return cached
    if (this.hasWrites) throw new Error('טרנזקציית Firestore אינה יכולה לבצע קריאה חדשה לאחר כתיבה')
    const snapshot = await this.transaction.get(reference)
    this.snapshots.set(reference.path, snapshot)
    return snapshot
  }

  private async getQuery(query: Query<DocumentData>): Promise<DocumentSnapshot[]> {
    if (this.hasWrites) throw new Error('טרנזקציית Firestore אינה יכולה לבצע שאילתה לאחר כתיבה')
    const snapshot = await this.transaction.get(query)
    for (const document of snapshot.docs) this.snapshots.set(document.ref.path, document)
    return snapshot.docs
  }

  private assertVersion(snapshot: DocumentSnapshot, expectedVersion: number, nextVersion: number): void {
    const actualVersion = snapshot.exists ? Number(snapshot.get('version')) : 0
    if (actualVersion !== expectedVersion) throw new ConcurrentModificationError(expectedVersion, actualVersion)
    if (nextVersion !== expectedVersion + 1) throw new ConcurrentModificationError(expectedVersion + 1, nextVersion)
  }
}

export class FirestoreNativRepository implements NativRepository {
  private readonly firestore: Firestore

  constructor(firestore: Firestore) {
    this.firestore = firestore
  }

  transact<TResult>(operation: (transaction: NativTransaction) => TResult | Promise<TResult>): Promise<TResult> {
    return this.firestore.runTransaction(async (transaction) => operation(new FirestoreNativTransaction(transaction, this.firestore)))
  }
}
