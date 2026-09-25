import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DirectionInput from './DirectionInput';
import type { TimelineCommentScope } from '../domain/schema';
afterEach(cleanup);
function Form({ scope = 'object', close = () => {} }: { scope?: TimelineCommentScope; close?: () => void }) {
  const [value, setValue] = useState('');
  return <DirectionInput value={value} onChange={setValue} scope={scope} onSave={() => {}} onClose={close} />;
}
describe('Menu slash', () => {
  it('sceglie da tastiera più preset e li mostra come badge', () => {
    render(<Form />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/scoc', selectionStart: 5 } });
    expect(screen.getByRole('option', { name: /Annoyed/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('');
    expect(screen.getByText('Annoyed')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '/si-av', selectionStart: 6 } });
    fireEvent.click(screen.getByRole('option', { name: /Approaches/ }));
    expect(input).toHaveValue('');
    expect(screen.getByText('Approaches')).toBeInTheDocument();
    expect(screen.queryByText(/postura afflosciata/)).not.toBeInTheDocument();
  });
  it('converte un vecchio token in badge, conserva il testo libero e consente la rimozione', () => {
    function Existing() {
      const [value, setValue] = useState('/felice saluta la camera');
      return <><DirectionInput value={value} onChange={setValue} scope="object" onSave={() => {}} onClose={() => {}} /><output role="status">{value}</output></>;
    }
    render(<Existing />);
    expect(screen.getByRole('textbox')).toHaveValue('saluta la camera');
    expect(screen.getByText('Happy')).toBeInTheDocument();
    expect(screen.getByText('/felice saluta la camera')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Happy' }));
    expect(screen.queryByText('Happy')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('saluta la camera');
    expect(screen.getByRole('status')).toHaveTextContent('saluta la camera');
  });
  it('mostra più emozioni come progressione e permette di riordinarle', () => {
    function Sequence() {
      const [value, setValue] = useState('/sorpreso /spaventato /scocciato controlla la bocca');
      return <><DirectionInput value={value} onChange={setValue} scope="object" onSave={() => {}} onClose={() => {}} /><output role="status">{value}</output></>;
    }
    render(<Sequence />);
    expect(screen.getByText('Emotional progression')).toBeInTheDocument();
    expect(screen.getAllByText('→')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Move Frightened earlier' }));
    expect(screen.getByRole('status')).toHaveTextContent('/spaventato /sorpreso /scocciato controlla la bocca');
  });
  it('filtra le camere e chiude solo il menu al primo Escape', () => {
    const close = vi.fn(); render(<Form scope="framing" close={close} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByRole('option', { name: /Static camera/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Annoyed/ })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' }); expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
  });
  it('non riempie né propone preset nella descrizione della scena', () => {
    render(<Form scope="scene" />); const input = screen.getByRole('textbox');
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: '/', selectionStart: 1 } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
