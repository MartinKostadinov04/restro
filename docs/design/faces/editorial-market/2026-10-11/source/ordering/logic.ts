import type { ViewItem, ViewModifierGroup } from '../types';

export type BagOption = { groupId: string; optionId: string; name: string; deltaMinor: number };
export type BagLine = { key: string; itemId: string; name: string; qty: number; unitMinor: number; options: BagOption[]; note: string };
export type TabStatus = 'received' | 'preparing' | 'served';
export type TabLine = { id: string; name: string; qty: number; totalMinor: number; status: TabStatus; options?: string[] };
export type TabRound = { id: string; source: 'app' | 'waiter'; time: string; lines: TabLine[] };
export type Selection = Record<string, string[]>;

export type BagAction =
  | { type: 'add'; line: Omit<BagLine, 'key'> }
  | { type: 'qty'; key: string; delta: number }
  | { type: 'remove'; key: string }
  | { type: 'replace'; key: string; line: Omit<BagLine, 'key'> }
  | { type: 'clear' };

export const lineKey = (l: Omit<BagLine, 'key'>) => `${l.itemId}|${l.options.map(o => o.optionId).sort().join(',')}|${l.note.trim()}`;
export const unitTotal = (l: Pick<BagLine, 'unitMinor' | 'options'>) => l.unitMinor + l.options.reduce((s, o) => s + o.deltaMinor, 0);
export const lineTotal = (l: BagLine) => unitTotal(l) * l.qty;
export const bagTotal = (bag: BagLine[]) => bag.reduce((s, l) => s + lineTotal(l), 0);
export const bagCount = (bag: BagLine[]) => bag.reduce((s, l) => s + l.qty, 0);

export function bagReducer(bag: BagLine[], a: BagAction): BagLine[] {
  switch (a.type) {
    case 'add': {
      const key = lineKey(a.line);
      const hit = bag.find(l => l.key === key);
      return hit ? bag.map(l => (l.key === key ? { ...l, qty: l.qty + a.line.qty } : l)) : [...bag, { ...a.line, key }];
    }
    case 'qty':
      return bag.flatMap(l => (l.key !== a.key ? [l] : l.qty + a.delta <= 0 ? [] : [{ ...l, qty: l.qty + a.delta }]));
    case 'remove':
      return bag.filter(l => l.key !== a.key);
    case 'replace': {
      const rest = bag.filter(l => l.key !== a.key);
      return bagReducer(rest, { type: 'add', line: a.line });
    }
    case 'clear':
      return [];
  }
}

export function groupValid(g: ViewModifierGroup, picked: string[] = []) {
  const min = g.required ? Math.max(1, g.min) : g.min;
  return picked.length >= min && (g.max <= 0 || picked.length <= g.max);
}
export const selectionValid = (groups: ViewModifierGroup[], sel: Selection) => groups.every(g => groupValid(g, sel[g.id]));
export function toggleOption(g: ViewModifierGroup, picked: string[] = [], id: string) {
  if (picked.includes(id)) return picked.filter(x => x !== id);
  if (g.max === 1) return [id];
  if (g.max > 0 && picked.length >= g.max) return picked;
  return [...picked, id];
}
export function selectionOptions(groups: ViewModifierGroup[], sel: Selection): BagOption[] {
  return groups.flatMap(g => g.options.filter(o => sel[g.id]?.includes(o.id)).map(o => ({ groupId: g.id, optionId: o.id, name: o.name.text, deltaMinor: o.delta?.minor ?? 0 })));
}
export const needsChoices = (item: ViewItem) => item.modifierGroups.some(g => g.required || g.min > 0);
export const orderable = (item: ViewItem) => !!item.price && item.state.code === 'available';

export function sendBag(rounds: TabRound[], bag: BagLine[], id: string, time: string): TabRound[] {
  if (!bag.length) return rounds;
  return [...rounds, { id, source: 'app', time, lines: bag.map(l => ({ id: `${id}-${l.key}`, name: l.name, qty: l.qty, totalMinor: lineTotal(l), status: 'received', options: l.options.map(o => o.name) })) }];
}
export const tabTotal = (rounds: TabRound[]) => rounds.reduce((s, r) => s + r.lines.reduce((t, l) => t + l.totalMinor, 0), 0);
export const myItemsTotal = (rounds: TabRound[]) => tabTotal(rounds.filter(r => r.source === 'app'));
export const splitEqually = (total: number, people: number) => Math.ceil(total / Math.max(1, Math.floor(people)));
export const tipAmount = (subtotal: number, percent: number) => Math.round((subtotal * percent) / 100);
export const vatIncluded = (gross: number, ratePercent: number) => Math.round((gross * ratePercent) / (100 + ratePercent));
