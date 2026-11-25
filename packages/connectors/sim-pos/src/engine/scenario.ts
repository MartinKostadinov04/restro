// A scenario: the simulated POS's starting data (#51 design §2.2), as plain JSON, so a test, the
// demo seed (#71) or a person can load it. It holds the floor, the catalogue, the payment types,
// the logins and any bills already open. It is the same under every switch: the engine keeps the
// logins its switches allow (one API login per bar, or one for every bar, Q19).

import type { SimArticle, SimBar, SimLogin, SimPaymentType, SimTable } from './state'

export interface ScenarioBill {
  readonly table: string
  readonly by: string
  /** Minutes before the engine's start. */
  readonly minutesAgo: number
  readonly rows: readonly { readonly article: string; readonly quantity: string }[]
}

export interface SimScenario {
  readonly bars: readonly SimBar[]
  readonly tables: readonly SimTable[]
  readonly articles: readonly Omit<SimArticle, 'soldOut'>[]
  readonly paymentTypes: readonly SimPaymentType[]
  readonly logins: readonly SimLogin[]
  readonly bills: readonly ScenarioBill[]
}

/** The test password of every simulated login. Not a secret: the simulator is local only. */
export const SIM_PASSWORD = 'sim-pos-local'

/**
 * The default scenario: two bars, each with its tables and payment tables, a small catalogue,
 * Restro's logins (per bar and for all bars), two waiters, and Table 8 already open.
 */
export const DEFAULT_SCENARIO: SimScenario = {
  bars: [
    { id: 'bar 1', name: 'Main bar' },
    { id: '4d1c9e70-6a52-4c0e-a1b3-7f2e8c90d415', name: 'Garden bar' },
  ],
  tables: [
    { id: '30007', number: '7', hall: 'Hall', bar: 'bar 1', payment: false },
    { id: 'T 8 hall', number: '8', hall: 'Hall', bar: 'bar 1', payment: false },
    {
      id: '0b6f3a8e-9c21-4f57-a0d4-2e81c7b5f903',
      number: '9',
      hall: 'Hall',
      bar: 'bar 1',
      payment: false,
    },
    {
      id: '30012',
      number: '12',
      hall: 'Garden',
      bar: '4d1c9e70-6a52-4c0e-a1b3-7f2e8c90d415',
      payment: false,
    },
    {
      id: 'G 14',
      number: '14',
      hall: 'Garden',
      bar: '4d1c9e70-6a52-4c0e-a1b3-7f2e8c90d415',
      payment: false,
    },
    { id: '39001', number: 'P1', hall: 'Hall', bar: 'bar 1', payment: true },
    { id: 'pay 2 main', number: 'P2', hall: 'Hall', bar: 'bar 1', payment: true },
    {
      id: '39003',
      number: 'P3',
      hall: 'Garden',
      bar: '4d1c9e70-6a52-4c0e-a1b3-7f2e8c90d415',
      payment: true,
    },
  ],
  articles: [
    { id: '1001', name: 'Cola 0.33', priceMinor: 450, tip: false },
    { id: 'gin tonic', name: 'Gin and tonic', priceMinor: 1200, tip: false },
    {
      id: 'a3e0c6d2-5b14-4e89-9f70-c2d41b8e6a37',
      name: 'Still water 0.5',
      priceMinor: 300,
      tip: false,
    },
    { id: '1004', name: 'Nachos', priceMinor: 895, tip: false },
    { id: 'shot 5', name: 'Tequila shot', priceMinor: 650, tip: false },
    { id: '1099', name: 'Tip', priceMinor: 0, tip: true },
  ],
  paymentTypes: [
    { id: '1', name: 'Cash', kind: 'cash' },
    { id: 'card 2', name: 'Card', kind: 'card' },
  ],
  logins: [
    { id: 'restro', password: SIM_PASSWORD, kind: 'api', name: 'Restro', bars: [] },
    {
      id: 'restro bar 1',
      password: SIM_PASSWORD,
      kind: 'api',
      name: 'Restro (Main bar)',
      bars: ['bar 1'],
    },
    {
      id: 'restro garden',
      password: SIM_PASSWORD,
      kind: 'api',
      name: 'Restro (Garden bar)',
      bars: ['4d1c9e70-6a52-4c0e-a1b3-7f2e8c90d415'],
    },
    { id: 'maria', password: SIM_PASSWORD, kind: 'waiter', name: 'Maria', bars: ['bar 1'] },
    {
      id: 'ivan',
      password: SIM_PASSWORD,
      kind: 'waiter',
      name: 'Ivan',
      bars: ['4d1c9e70-6a52-4c0e-a1b3-7f2e8c90d415'],
    },
  ],
  bills: [
    {
      table: 'T 8 hall',
      by: 'maria',
      minutesAgo: 50,
      rows: [
        { article: '1001', quantity: '2' },
        { article: 'gin tonic', quantity: '1' },
        { article: '1004', quantity: '0.5' },
      ],
    },
  ],
}
