export const FONT_OPTIONS = [
  { id: 'system', label: 'Moderno', css: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: 'arial', label: 'Classico', css: 'Arial, Helvetica, sans-serif' },
  { id: 'georgia', label: 'Editoriale', css: 'Georgia, "Times New Roman", serif' },
  { id: 'trebuchet', label: 'Morbido', css: '"Trebuchet MS", Arial, sans-serif' },
  { id: 'courier', label: 'Monospazio', css: '"Courier New", Courier, monospace' },
] as const;

export type FontId = (typeof FONT_OPTIONS)[number]['id'];
export const fontCss = (font: FontId = 'system') => FONT_OPTIONS.find((option) => option.id === font)?.css ?? FONT_OPTIONS[0].css;
export const systemFontFile = (font: FontId) => font === 'system' ? undefined : `/System/Library/Fonts/Supplemental/${({ arial: 'Arial.ttf', georgia: 'Georgia.ttf', trebuchet: 'Trebuchet MS.ttf', courier: 'Courier New.ttf' } as const)[font]}`;
