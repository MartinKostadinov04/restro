import type { Locale, ViewItem, ViewModel, ViewModifierGroup, ViewSection } from '../types';
import type { TabRound } from './logic';

// Preview-only demo data. In production the upstream shell supplies these.
export const formatEur = (locale: Locale) => (minor: number) =>
  new Intl.NumberFormat(locale.replace('_', '-'), { style: 'currency', currency: 'EUR' }).format(minor / 100);

const t = (text: string, lang: Locale) => ({ text, lang });
function demoGroups(locale: Locale, fmt: (n: number) => string): ViewModifierGroup[] {
  const bg = locale === 'bg_BG';
  const d = (n: number) => ({ minor: n, currency: 'EUR' as const, text: `+${fmt(n)}` });
  return [
    { id: 'size', name: t(bg ? 'Размер' : 'Size', locale), min: 1, max: 1, required: true, options: [
      { id: 'reg', name: t(bg ? 'Стандартна' : 'Regular', locale), delta: null },
      { id: 'lg', name: t(bg ? 'Голяма' : 'Large', locale), delta: d(250) } ] },
    { id: 'extra', name: t(bg ? 'Добавки' : 'Extras', locale), min: 0, max: 3, required: false, options: [
      { id: 'avo', name: t(bg ? 'Авокадо' : 'Avocado', locale), delta: d(180) },
      { id: 'egg', name: t(bg ? 'Яйце' : 'Egg', locale), delta: d(120) },
      { id: 'feta', name: t(bg ? 'Сирене' : 'Feta', locale), delta: d(150) },
      { id: 'chili', name: t(bg ? 'Люто' : 'Chili', locale), delta: null } ] },
  ];
}
export function withDemoChoices(view: ViewModel): ViewModel {
  const fmt = formatEur(view.locale); let n = 0;
  const walk = (s: ViewSection): ViewSection => ({ ...s, items: s.items.map((i): ViewItem => (i.price && !i.modifierGroups.length && n++ % 3 === 0 ? { ...i, modifierGroups: demoGroups(view.locale, fmt) } : i)), sections: s.sections.map(walk) });
  return { ...view, sections: view.sections.map(walk) };
}
export function demoTab(locale: Locale): TabRound[] {
  const bg = locale === 'bg_BG';
  return [{ id: 'pos-1', source: 'waiter', time: '19:42', lines: [
    { id: 'w1', name: bg ? 'Минерална вода 750 мл' : 'Still water 750 ml', qty: 1, totalMinor: 450, status: 'served' },
    { id: 'w2', name: bg ? 'Чаша домашно вино' : 'Glass of house wine', qty: 2, totalMinor: 1400, status: 'served' },
    { id: 'w3', name: bg ? 'Хляб с масло' : 'Bread & butter', qty: 1, totalMinor: 380, status: 'preparing' } ] }];
}
