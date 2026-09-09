import { expect, it, vi } from 'vitest'
import { resolveSession, withSessionTimeout } from './sessionResolution'

const user = { uid: 'same-user', providerData: [{ providerId: 'google.com' }] }
function setup() {
  return {
    getAccess: vi.fn().mockRejectedValueOnce(new Error('לא נמצא שיוך ארגוני פעיל')).mockResolvedValue({ roles: ['student'] }),
    listSchools: vi.fn().mockResolvedValue([{ id: 'school', name: 'בית ספר', role: 'student' }]),
    exchange: vi.fn().mockResolvedValue('test-token'), signIn: vi.fn().mockResolvedValue({ user }),
    isCurrent: () => true, allowExchange: true,
  }
}
it('finishes loading after a same-UID Google exchange without a second auth event', async () => {
  const dependencies = setup()
  await expect(resolveSession(user, dependencies)).resolves.toMatchObject({ user, access: { roles: ['student'] } })
  expect(dependencies.getAccess).toHaveBeenCalledTimes(2)
})
it('does not sign in after the request is superseded', async () => {
  const dependencies = { ...setup(), isCurrent: () => false }
  await expect(resolveSession(user, dependencies)).rejects.toThrow()
  expect(dependencies.signIn).not.toHaveBeenCalled()
})
it('returns school choices without silently selecting one', async () => {
  const dependencies = setup()
  dependencies.listSchools.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
  await expect(resolveSession(user, dependencies)).resolves.toHaveProperty('schools')
  expect(dependencies.exchange).not.toHaveBeenCalled()
})
it('ends a stalled load with an actionable error', async () => {
  await expect(withSessionTimeout(new Promise(() => {}), 10)).rejects.toThrow('אפשר לנסות שוב')
})
