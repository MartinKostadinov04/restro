import { describe, expect, it } from 'vitest';
import { resolveExampleTheme, themeExamples } from '@/features/restro-face/fixtures/themes/examples';
import { themeVariables } from '@/features/restro-face/model';
import type { ViewModel } from '@/features/restro-face/types';
import menu from '@/features/restro-face/fixtures/menu-demo.en.json';

const view = menu as ViewModel;
describe('platform theme boundary', () => {
  it('keeps all four review examples with both eight-role palettes', () => {
    expect(Object.keys(themeExamples)).toEqual(['botanical', 'midnight', 'nordic', 'terracotta']);
    for (const example of Object.values(themeExamples)) {
      expect(Object.keys(example.colors)).toHaveLength(8);
      expect(Object.keys(example.colorsDark)).toHaveLength(8);
    }
  });
  it('resolves an example without changing content or other platform attributes', () => {
    const next = resolveExampleTheme(view, 'nordic');
    expect(next.sections).toBe(view.sections);
    expect(next.theme.colors.accent).toBe('#2F5BEA');
    expect(next.theme.colorsDark.accent).toBe('#6E8EFF');
    expect(next.theme.radius).toBe(4);
    expect(next.theme.font).toBe(view.theme.font);
    expect(next.theme.logo).toBe(view.theme.logo);
    expect(view.theme).not.toBe(next.theme);
  });
  it('maps arbitrary platform values, not just preset IDs, to rendering variables', () => {
    const next: ViewModel = { ...view, theme: { ...view.theme, radius: 9, font: 'venue-font', colors: { ...view.theme.colors, accent: '#126847' } } };
    const vars = themeVariables(next, { 'venue-font': 'Venue Sans, sans-serif' }) as Record<string, string>;
    expect(vars['--rm-l-accent']).toBe('#126847');
    expect(vars['--rm-radius']).toBe('9px');
    expect(vars['--rm-font']).toBe('Venue Sans, sans-serif');
  });
});