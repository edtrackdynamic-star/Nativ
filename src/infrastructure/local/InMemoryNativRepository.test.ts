import { describe, expect, it } from 'vitest'
import { demoCycle } from '../../demo/demoCycle'
import { ConcurrentModificationError } from '../../domain/types'
import { InMemoryNativRepository } from './InMemoryNativRepository'

describe('InMemoryNativRepository', () => {
  it('commits a valid transaction and returns defensive copies', async () => {
    const repository = new InMemoryNativRepository({ cycles: [demoCycle] })
    const cycle = await repository.transact((transaction) => transaction.getCycle(demoCycle.organizationId, demoCycle.id))
    expect(cycle?.id).toBe(demoCycle.id)
    if (cycle) cycle.termLabel = 'שונה מחוץ למאגר'
    const reread = await repository.transact((transaction) => transaction.getCycle(demoCycle.organizationId, demoCycle.id))
    expect(reread?.termLabel).toBe(demoCycle.termLabel)
  })

  it('rolls back all writes when a transaction fails', async () => {
    const repository = new InMemoryNativRepository({ cycles: [demoCycle] })
    await expect(repository.transact(async (transaction) => {
      await transaction.appendAuditEvent({ id: 'audit-failed', organizationId: demoCycle.organizationId, actorId: 'user-1', occurredAt: '2026-08-28T08:00:00Z', action: 'test', entityType: 'test', entityId: 'test', reason: 'test' })
      throw new Error('failure')
    })).rejects.toThrow('failure')
    const audits = await repository.transact((transaction) => transaction.listAuditEvents(demoCycle.organizationId))
    expect(audits).toEqual([])
  })

  it('blocks a stale entity save', async () => {
    const repository = new InMemoryNativRepository({ cycles: [demoCycle] })
    await expect(repository.transact(async (transaction) => {
      await transaction.saveCycle({ ...demoCycle, version: demoCycle.version + 1 }, demoCycle.version - 1)
    })).rejects.toThrow(ConcurrentModificationError)
  })
})
