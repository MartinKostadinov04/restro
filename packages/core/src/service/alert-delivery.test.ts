import { describe, expect, it } from 'vitest'

import {
  type DeliveryState,
  type PlanInput,
  type PlannedAlert,
  planDelivery,
  readDelivery,
  recordStep,
  withDelivery,
} from './alert-delivery'
import { PAUSED_KIND } from './alert-rules'

const NOW = new Date('2026-10-23T20:00:00Z')
const at = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000)
const iso = (secondsAgo: number) => at(secondsAgo).toISOString()

const OPEN_WINDOW = {
  date: '2026-10-23',
  opensAt: new Date('2026-10-23T10:00:00Z'),
  closesAt: new Date('2026-10-24T02:00:00Z'),
  inService: true,
}
const CLOSED_WINDOW = { ...OPEN_WINDOW, inService: false }
const EVERYWHERE = { push: true, venueTelegram: true, team: true }

function alert(partial: Partial<PlannedAlert> & { id: string }): PlannedAlert {
  return {
    kind: 'order_unconfirmed',
    audience: 'venue',
    raisedAt: at(60),
    doneAt: null,
    delivery: {},
    telegramRef: null,
    ...partial,
  }
}

function plan(alerts: PlannedAlert[], overrides: Partial<PlanInput> = {}) {
  return planDelivery({
    now: NOW,
    window: OPEN_WINDOW,
    reachable: EVERYWHERE,
    alerts,
    ...overrides,
  })
}

describe('a new alert', () => {
  it('goes to the ticked accounts, the venue group and the Restro team', () => {
    const result = plan([alert({ id: 'al_1' })])
    expect(result.steps).toEqual([
      { receiver: 'push', step: 'new', alertIds: ['al_1'], ownersOnly: false },
      { receiver: 'venueTelegram', step: 'new', alertIds: ['al_1'], ownersOnly: false },
      { receiver: 'team', step: 'new', alertIds: ['al_1'], ownersOnly: false },
    ])
    expect(result.suppress).toEqual([])
  })

  it('waits 10 seconds so a burst of Unconfirmed orders goes as one push', () => {
    expect(
      plan([alert({ id: 'al_1', raisedAt: at(5) })]).steps.map((step) => step.receiver),
    ).toEqual(['team'])
    const result = plan([
      alert({ id: 'al_1', raisedAt: at(40) }),
      alert({ id: 'al_2', raisedAt: at(12) }),
      alert({ id: 'al_3', raisedAt: at(3) }),
    ])
    const push = result.steps.find((step) => step.receiver === 'push')
    expect(push?.alertIds).toEqual(['al_1', 'al_2'])
  })

  it('sends one message to the venue group for each alert, so each has its own Done', () => {
    const result = plan([alert({ id: 'al_1' }), alert({ id: 'al_2' })])
    const group = result.steps.filter((step) => step.receiver === 'venueTelegram')
    expect(group.map((step) => step.alertIds)).toEqual([['al_1'], ['al_2']])
  })

  it('sends at most one push a minute, and one team digest every 10 minutes', () => {
    const told: DeliveryState = {
      push: { firstAt: iso(30), lastAt: iso(30), count: 1 },
      team: { firstAt: iso(300), lastAt: iso(300), count: 1 },
    }
    const result = plan([
      alert({ id: 'al_old', raisedAt: at(200), delivery: told }),
      alert({ id: 'al_new', raisedAt: at(20) }),
    ])
    expect(result.steps.filter((step) => step.step === 'new').map((step) => step.receiver)).toEqual(
      ['venueTelegram', 'venueTelegram'],
    )
    const later = plan(
      [
        alert({ id: 'al_old', raisedAt: at(200), delivery: told }),
        alert({ id: 'al_new', raisedAt: at(20) }),
      ],
      { now: new Date(NOW.getTime() + 31_000) },
    )
    expect(later.steps.find((step) => step.receiver === 'push')?.alertIds).toEqual(['al_new'])
    expect(later.steps.find((step) => step.receiver === 'team')).toBeUndefined()
  })

  it('goes only to the Restro team when it is the team’s alert', () => {
    const result = plan([alert({ id: 'al_1', kind: 'order_pace', audience: 'restro' })])
    expect(result.steps).toEqual([
      { receiver: 'team', step: 'new', alertIds: ['al_1'], ownersOnly: false },
    ])
  })

  it('skips a receiver that has nobody to tell, and the stock notice altogether', () => {
    const result = plan([alert({ id: 'al_1' }), alert({ id: 'al_2', kind: 'item_out_of_stock' })], {
      reachable: { push: false, venueTelegram: false, team: true },
    })
    expect(result.steps).toEqual([
      { receiver: 'team', step: 'new', alertIds: ['al_1'], ownersOnly: false },
    ])
  })

  it('is not sent twice', () => {
    const told: DeliveryState = {
      push: { firstAt: iso(30), lastAt: iso(30), count: 1 },
      venueTelegram: { firstAt: iso(30), lastAt: iso(30), count: 1 },
      team: { firstAt: iso(30), lastAt: iso(30), count: 1 },
    }
    expect(plan([alert({ id: 'al_1', delivery: told })]).steps).toEqual([])
  })
})

describe('an old alert nobody was told about', () => {
  it('is not announced late: a venue that links its group today hears nothing of last night', () => {
    const old = alert({ id: 'al_old', raisedAt: at(7 * 3600) })
    expect(plan([old]).steps).toEqual([])
  })

  it('still counts for a pause, which is announced at opening', () => {
    const pause = alert({
      id: 'al_p',
      kind: PAUSED_KIND,
      raisedAt: new Date(OPEN_WINDOW.opensAt.getTime() - 5 * 3_600_000),
      delivery: { suppressed: true },
    })
    expect(plan([pause]).steps.map((step) => step.step)).toContain('still_paused')
  })
})

describe('quiet hours (D120: nothing outside service hours)', () => {
  it('holds back an alert raised while the venue is closed, and says to drop it', () => {
    const result = plan([alert({ id: 'al_1' })], { window: CLOSED_WINDOW })
    expect(result.steps).toEqual([])
    expect(result.suppress).toEqual(['al_1'])
  })

  it('never sends a suppressed alert later', () => {
    const result = plan([alert({ id: 'al_1', delivery: { suppressed: true } })])
    expect(result.steps).toEqual([])
    expect(result.suppress).toEqual([])
  })

  it('lets the pre-opening check through', () => {
    const result = plan([alert({ id: 'al_1', kind: 'pre_opening_check' })], {
      window: CLOSED_WINDOW,
    })
    expect(result.steps.map((step) => step.receiver)).toEqual(['push', 'venueTelegram', 'team'])
  })

  it('sends no reminder outside service hours', () => {
    const told: DeliveryState = { push: { firstAt: iso(900), lastAt: iso(900), count: 1 } }
    const result = plan([alert({ id: 'al_1', raisedAt: at(900), delivery: told })], {
      window: CLOSED_WINDOW,
    })
    expect(result.steps).toEqual([])
  })
})

describe('reminders', () => {
  it('reminds once after 10 minutes if nobody acted on an Unconfirmed order', () => {
    const told: DeliveryState = { push: { firstAt: iso(601), lastAt: iso(601), count: 1 } }
    const result = plan([alert({ id: 'al_1', raisedAt: at(620), delivery: told })])
    expect(result.steps).toContainEqual({
      receiver: 'push',
      step: 'reminder',
      alertIds: ['al_1'],
      ownersOnly: false,
    })
  })

  it('does not remind twice', () => {
    const once = { firstAt: iso(2000), lastAt: iso(2000), count: 1 }
    const told: DeliveryState = {
      push: { firstAt: iso(2000), lastAt: iso(700), count: 2 },
      venueTelegram: once,
      team: once,
    }
    expect(plan([alert({ id: 'al_1', raisedAt: at(2000), delivery: told })]).steps).toEqual([])
  })

  it('reminds the owners once after an hour about a pause, and the team hourly up to 3 times', () => {
    const hour = 3600
    const told: DeliveryState = {
      push: { firstAt: iso(hour + 5), lastAt: iso(hour + 5), count: 1 },
      venueTelegram: { firstAt: iso(hour + 5), lastAt: iso(hour + 5), count: 1 },
      team: { firstAt: iso(hour + 5), lastAt: iso(hour + 5), count: 1 },
    }
    const result = plan([
      alert({ id: 'al_p', kind: PAUSED_KIND, raisedAt: at(hour + 5), delivery: told }),
    ])
    expect(result.steps).toEqual([
      { receiver: 'push', step: 'reminder', alertIds: ['al_p'], ownersOnly: true },
      { receiver: 'team', step: 'reminder', alertIds: ['al_p'], ownersOnly: false },
    ])
    const fourth: DeliveryState = {
      team: { firstAt: iso(4 * hour), lastAt: iso(hour + 1), count: 4 },
    }
    expect(
      plan([
        alert({ id: 'al_p', kind: PAUSED_KIND, raisedAt: at(4 * hour), delivery: fourth }),
      ]).steps.filter((step) => step.receiver === 'team'),
    ).toEqual([])
  })
})

describe('"back" and Done', () => {
  const pauseTold: DeliveryState = {
    push: { firstAt: iso(1800), lastAt: iso(1800), count: 1 },
    venueTelegram: { firstAt: iso(1800), lastAt: iso(1800), count: 1 },
    team: { firstAt: iso(1800), lastAt: iso(1800), count: 1 },
  }

  it('tells everyone who heard "paused" that ordering is back, 10 minutes after the pause lifted', () => {
    const closed = (secondsAgo: number) =>
      alert({
        id: 'al_p',
        kind: PAUSED_KIND,
        raisedAt: at(2000),
        doneAt: at(secondsAgo),
        delivery: pauseTold,
      })
    expect(plan([closed(300)]).steps).toEqual([])
    expect(plan([closed(601)]).steps.map((step) => [step.receiver, step.step])).toEqual([
      ['push', 'back'],
      ['venueTelegram', 'back'],
      ['team', 'back'],
    ])
  })

  it('does not say "back" to a receiver that never heard of the pause, nor twice', () => {
    const quiet = alert({
      id: 'al_p',
      kind: PAUSED_KIND,
      raisedAt: at(2000),
      doneAt: at(700),
      delivery: { suppressed: true },
    })
    expect(plan([quiet]).steps).toEqual([])
    const done = alert({
      id: 'al_p',
      kind: PAUSED_KIND,
      raisedAt: at(2000),
      doneAt: at(700),
      delivery: {
        push: { firstAt: iso(1800), lastAt: iso(1800), count: 1, backAt: iso(60) },
      },
    })
    expect(plan([done]).steps).toEqual([])
  })

  it('says "back" outside service hours too, to those who were told', () => {
    const closed = alert({
      id: 'al_p',
      kind: PAUSED_KIND,
      raisedAt: at(2000),
      doneAt: at(700),
      delivery: pauseTold,
    })
    expect(plan([closed], { window: CLOSED_WINDOW }).steps).toHaveLength(3)
  })

  it('has the bot edit the venue group’s message once an alert is Done elsewhere', () => {
    const done = alert({
      id: 'al_1',
      doneAt: at(30),
      telegramRef: '-1:9',
      delivery: {
        venueTelegram: { firstAt: iso(100), lastAt: iso(100), count: 1 },
      },
    })
    expect(plan([done]).steps).toEqual([
      { receiver: 'venueTelegram', step: 'done_edit', alertIds: ['al_1'], ownersOnly: false },
    ])
    const edited = alert({
      id: 'al_1',
      doneAt: at(30),
      telegramRef: '-1:9',
      delivery: {
        venueTelegram: {
          firstAt: iso(100),
          lastAt: iso(100),
          count: 1,
          editedDoneAt: iso(10),
        },
      },
    })
    expect(plan([edited]).steps).toEqual([])
  })
})

describe('"still paused" at opening', () => {
  const pausedSince = (hoursAgo: number, delivery: DeliveryState = {}) =>
    alert({
      id: 'al_p',
      kind: PAUSED_KIND,
      raisedAt: new Date(OPEN_WINDOW.opensAt.getTime() - hoursAgo * 3_600_000),
      delivery,
    })

  it('tells everyone once when the venue opens still paused', () => {
    const result = plan([pausedSince(5, { suppressed: true })])
    expect(result.steps.map((step) => [step.receiver, step.step])).toEqual([
      ['push', 'still_paused'],
      ['venueTelegram', 'still_paused'],
      ['team', 'still_paused'],
    ])
    expect(result.suppress).toEqual([])
  })

  it('does it once a service day', () => {
    const told: DeliveryState = {
      push: { firstAt: iso(100), lastAt: iso(100), count: 2, stillPausedOn: '2026-10-23' },
      venueTelegram: {
        firstAt: iso(100),
        lastAt: iso(100),
        count: 2,
        stillPausedOn: '2026-10-23',
      },
      team: { firstAt: iso(100), lastAt: iso(100), count: 2, stillPausedOn: '2026-10-23' },
    }
    expect(plan([pausedSince(5, told)]).steps).toEqual([])
  })

  it('says nothing before the venue opens', () => {
    const result = plan([pausedSince(5, { suppressed: true })], { window: CLOSED_WINDOW })
    expect(result.steps).toEqual([])
  })
})

describe('recordStep', () => {
  const first = new Date('2026-10-23T20:00:00Z')

  it('opens a receiver’s state on its first message', () => {
    const state = recordStep({}, 'push', 'new', first)
    expect(state.push).toEqual({
      firstAt: first.toISOString(),
      lastAt: first.toISOString(),
      count: 1,
    })
  })

  it('counts a reminder and keeps the first time', () => {
    const later = new Date(first.getTime() + 600_000)
    const state = recordStep(recordStep({}, 'team', 'new', first), 'team', 'reminder', later)
    expect(state.team).toEqual({
      firstAt: first.toISOString(),
      lastAt: later.toISOString(),
      count: 2,
    })
  })

  it('marks back, the edit to Done and "still paused"', () => {
    let state = recordStep({}, 'venueTelegram', 'new', first)
    state = recordStep(state, 'venueTelegram', 'done_edit', first)
    expect(state.venueTelegram?.editedDoneAt).toBe(first.toISOString())
    state = recordStep(state, 'venueTelegram', 'back', first)
    expect(state.venueTelegram?.backAt).toBe(first.toISOString())
    state = recordStep(state, 'venueTelegram', 'still_paused', first, { day: '2026-10-23' })
    expect(state.venueTelegram?.stillPausedOn).toBe('2026-10-23')
  })
})

describe('the state in the alert’s details', () => {
  it('reads what was written and shrugs off what was not', () => {
    const state = recordStep({}, 'push', 'new', NOW)
    expect(readDelivery({ delivery: state, reference: 'K7Q' })).toEqual(state)
    expect(readDelivery({})).toEqual({})
    expect(readDelivery({ delivery: { push: 'yes' } })).toEqual({})
  })

  it('writes it back beside the other details', () => {
    const state = recordStep({}, 'team', 'new', NOW)
    expect(withDelivery({ reference: 'K7Q' }, state)).toEqual({ reference: 'K7Q', delivery: state })
  })
})
