import type { SemanticColors, ViewModel } from '../../types';
import presetsJson from './presets.json';

/** Review fixtures only. Production supplies the resolved theme from the platform. */
export type ThemeExample = {
  label: string;
  radius: number;
  colors: SemanticColors;
  colorsDark: SemanticColors;
};
export const themeExamples: Record<string, ThemeExample> = presetsJson;

/** Emulates a platform choosing a theme without adding preset knowledge to the face. */
export function resolveExampleTheme(view: ViewModel, id: string): ViewModel {
  const example = themeExamples[id];
  if (!example) return view;
  return {
    ...view,
    theme: { ...view.theme, colors: example.colors, colorsDark: example.colorsDark, radius: example.radius },
  };
}