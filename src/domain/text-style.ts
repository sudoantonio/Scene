export const FONT_OPTIONS = [
  { id: 'system', label: 'Sistema', css: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif', file: null },
  { id: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif', file: 'Supplemental/Arial.ttf' },
  { id: 'arial_black', label: 'Arial Black', css: '"Arial Black", Arial, sans-serif', file: 'Supplemental/Arial Black.ttf' },
  { id: 'arial_rounded', label: 'Arial Rounded', css: '"Arial Rounded MT Bold", Arial, sans-serif', file: 'Supplemental/Arial Rounded Bold.ttf' },
  { id: 'georgia', label: 'Georgia', css: 'Georgia, "Times New Roman", serif', file: 'Supplemental/Georgia.ttf' },
  { id: 'times', label: 'Times New Roman', css: '"Times New Roman", Times, serif', file: 'Supplemental/Times New Roman.ttf' },
  { id: 'trebuchet', label: 'Trebuchet MS', css: '"Trebuchet MS", Arial, sans-serif', file: 'Supplemental/Trebuchet MS.ttf' },
  { id: 'verdana', label: 'Verdana', css: 'Verdana, Geneva, sans-serif', file: 'Supplemental/Verdana.ttf' },
  { id: 'courier', label: 'Courier New', css: '"Courier New", Courier, monospace', file: 'Supplemental/Courier New.ttf' },
  { id: 'monaco', label: 'Monaco', css: 'Monaco, monospace', file: 'Monaco.ttf' },
  { id: 'geneva', label: 'Geneva', css: 'Geneva, Verdana, sans-serif', file: 'Geneva.ttf' },
  { id: 'comic', label: 'Comic Sans MS', css: '"Comic Sans MS", cursive', file: 'Supplemental/Comic Sans MS.ttf' },
  { id: 'bradley', label: 'Bradley Hand', css: '"Bradley Hand", cursive', file: 'Supplemental/Bradley Hand Bold.ttf' },
  { id: 'impact', label: 'Impact', css: 'Impact, "Arial Black", sans-serif', file: 'Supplemental/Impact.ttf' },
] as const;

export type FontId = (typeof FONT_OPTIONS)[number]['id'];
export const fontCss = (font: FontId = 'system') => FONT_OPTIONS.find((option) => option.id === font)?.css ?? FONT_OPTIONS[0].css;
export const systemFontFile = (font: FontId) => {
  const file = FONT_OPTIONS.find((option) => option.id === font)?.file;
  return file ? `/System/Library/Fonts/${file}` : undefined;
};
