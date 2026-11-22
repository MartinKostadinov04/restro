// switchOrganization (lane 6 step 0, S1): a shared device stays its own organisation's device, and
// a person's own sign-in still switches. Better Auth's `/organization/set-active` is closed over
// HTTP (auth.ts), so these server actions are the only ways to switch.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({
  device: false,
  setActive: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('./session', () => ({
  requireAccess: async () => ({
    sessionId: 'se_1',
    organization: { id: 'tn_A' },
    organizations: [{ id: 'tn_A' }, { id: 'tn_B' }],
  }),
}))
vi.mock('./staff/shared-device', () => ({ onSharedDevice: async () => world.device }))
vi.mock('./auth', () => ({ getAuth: () => ({ api: { setActiveOrganization: world.setActive } }) }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: world.redirect }))

import { returnToOrganization, switchOrganization } from './actions'

describe('switchOrganization', () => {
  beforeEach(() => {
    world.setActive.mockReset()
    world.redirect.mockReset()
  })

  it('switches a person to another organisation they belong to', async () => {
    world.device = false
    await switchOrganization('tn_B')
    expect(world.setActive).toHaveBeenCalledWith(
      expect.objectContaining({ body: { organizationId: 'tn_B' } }),
    )
    expect(world.redirect).toHaveBeenCalledWith('/venues')
  })

  it('refuses a shared device, even to an organisation the account belongs to', async () => {
    world.device = true
    await switchOrganization('tn_B')
    expect(world.setActive).not.toHaveBeenCalled()
    expect(world.redirect).not.toHaveBeenCalled()
  })

  it('refuses an organisation the person does not belong to', async () => {
    world.device = false
    await switchOrganization('tn_C')
    expect(world.setActive).not.toHaveBeenCalled()
  })
})

describe('returnToOrganization', () => {
  beforeEach(() => {
    world.setActive.mockReset()
    world.redirect.mockReset()
  })

  it("puts a person's fresh sign-in back in their organisation, where they are", async () => {
    world.device = false
    expect(await returnToOrganization('tn_B')).toEqual({ ok: true })
    expect(world.setActive).toHaveBeenCalledWith(
      expect.objectContaining({ body: { organizationId: 'tn_B' } }),
    )
    expect(world.redirect).not.toHaveBeenCalled()
  })

  it('refuses a shared device', async () => {
    world.device = true
    expect(await returnToOrganization('tn_B')).toEqual({ ok: false })
    expect(world.setActive).not.toHaveBeenCalled()
  })

  it('refuses an organisation the person does not belong to', async () => {
    world.device = false
    expect(await returnToOrganization('tn_C')).toEqual({ ok: false })
    expect(world.setActive).not.toHaveBeenCalled()
  })
})
