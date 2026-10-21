import { describe, expect, it } from 'vitest';
import { bagReducer, bagTotal, myItemsTotal, selectionValid, sendBag, splitEqually, tabTotal, tipAmount, type TabRound } from '@/features/restro-face/ordering/logic';
import type { ViewModifierGroup } from '@/features/restro-face/types';

const size: ViewModifierGroup = { id: 'size', name: { text: 'Size', lang: 'en_US' }, min: 1, max: 1, required: true, options: [{ id: 'lg', name: { text: 'Large', lang: 'en_US' }, delta: { minor: 250, currency: 'EUR', text: '+2.50' } }] };
const line = { itemId: 'a', name: 'Bowl', qty: 1, unitMinor: 1000, options: [], note: '' };

describe('ordering rules', () => {
  it('required choices block adding until picked', () => {
    expect(selectionValid([size], {})).toBe(false);
    expect(selectionValid([size], { size: ['lg'] })).toBe(true);
  });
  it('stepper quantities drive the bag total, choices add their price', () => {
    let bag = bagReducer([], { type: 'add', line });
    bag = bagReducer(bag, { type: 'add', line });
    expect(bag).toHaveLength(1);
    expect(bagTotal(bag)).toBe(2000);
    bag = bagReducer(bag, { type: 'add', line: { ...line, options: [{ groupId: 'size', optionId: 'lg', name: 'Large', deltaMinor: 250 }] } });
    expect(bagTotal(bag)).toBe(3250);
  });
  it('removing an item or stepping to zero drops it', () => {
    const bag = bagReducer([], { type: 'add', line });
    expect(bagReducer(bag, { type: 'remove', key: bag[0]!.key })).toEqual([]);
    expect(bagReducer(bag, { type: 'qty', key: bag[0]!.key, delta: -1 })).toEqual([]);
  });
  it('sending moves the bag into the table tab next to waiter rounds', () => {
    const waiter: TabRound[] = [{ id: 'w', source: 'waiter', time: '19:00', lines: [{ id: 'x', name: 'Water', qty: 1, totalMinor: 450, status: 'served' }] }];
    const bag = bagReducer([], { type: 'add', line: { ...line, qty: 2 } });
    const rounds = sendBag(waiter, bag, 'r1', '19:10');
    expect(rounds.map(r => r.source)).toEqual(['waiter', 'app']);
    expect(tabTotal(rounds)).toBe(2450);
    expect(myItemsTotal(rounds)).toBe(2000);
  });
  it('splits equally rounding up so the bill is covered', () => {
    expect(splitEqually(1000, 3)).toBe(334);
    expect(splitEqually(2450, 2)).toBe(1225);
  });
  it('tip percentages', () => {
    expect(tipAmount(2450, 10)).toBe(245);
    expect(tipAmount(2450, 15)).toBe(368);
    expect(tipAmount(2450, 0)).toBe(0);
  });
});
