import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FontPicker from './FontPicker';
import { FONT_OPTIONS, systemFontFile } from '../domain/text-style';

afterEach(cleanup);

it('previews each font in its own family and selects it', () => {
  const onChange = vi.fn();
  render(<FontPicker name="Text font" value="system" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Text font' }));
  expect(screen.getByRole('listbox').parentElement).toBe(document.body);
  expect(screen.getByRole('listbox')).toHaveStyle({ position: 'fixed' });
  const options = screen.getAllByRole('option');
  expect(options).toHaveLength(FONT_OPTIONS.length);
  expect(FONT_OPTIONS.length).toBeGreaterThan(10);
  for (const [index, font] of FONT_OPTIONS.entries()) {
    expect(options[index]).toHaveTextContent(font.label);
    expect(options[index]).toHaveStyle({ fontFamily: font.css });
  }
  fireEvent.click(screen.getByRole('option', { name: /Impact/ }));
  expect(onChange).toHaveBeenCalledWith('impact');
  expect(systemFontFile('impact')).toBe('/System/Library/Fonts/Supplemental/Impact.ttf');
});
