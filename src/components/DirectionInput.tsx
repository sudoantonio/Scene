import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { presetsForScope, resolvePresets } from '../domain/direction-presets';
import type { DirectionPreset, TimelineCommentScope } from '../domain/schema';

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function visibleDirectionText(value: string, scope: TimelineCommentScope) {
  const ids = resolvePresets(value, scope).map((preset) => escaped(preset.id));
  if (!ids.length) return value;
  return value
    .replace(new RegExp(`(^|\\s)\\/(?:${ids.join('|')})(?=$|\\s|[.,;:!?])`, 'g'), '$1')
    .replace(/^[ \t]+/, '');
}

export const composeDirection = (presets: DirectionPreset[], text: string) => {
  const badges = presets.map((preset) => `/${preset.id}`).join(' ');
  return badges && text ? `${badges} ${text}` : badges || text;
};

export default function DirectionInput({ value, onChange, scope, onSave, onClose, label = 'Direction notes' }: {
  value: string; onChange(text: string): void; scope: TimelineCommentScope; label?: string; onSave(): void; onClose(): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [match, setMatch] = useState<{ start: number; end: number; query: string }>();
  const [active, setActive] = useState(0);
  const selected = resolvePresets(value, scope);
  const emotions = selected.filter((preset) => preset.category === 'emotion');
  const actions = selected.filter((preset) => preset.category !== 'emotion');
  const text = visibleDirectionText(value, scope);
  const selectedIds = new Set(selected.map((preset) => preset.id));
  const choices = presetsForScope(scope).filter(p => !selectedIds.has(p.id) && (!match || `${p.label} ${p.id}`.toLowerCase().includes(match.query.toLowerCase())));
  const updateQuery = (text: string, caret: number) => {
    const result = text.slice(0, caret).match(/(?:^|\s)\/([^\s/]*)$/);
    setMatch(scope !== 'scene' && result ? { start: caret - result[1].length - 1, end: caret + (text.slice(caret).match(/^[a-z0-9-]*/i)?.[0].length ?? 0), query: result[1] } : undefined);
    setActive(0);
  };
  const choose = (id: string) => {
    if (!match) return;
    const preset = presetsForScope(scope).find((candidate) => candidate.id === id);
    if (!preset) return;
    const nextText = text.slice(0, match.start) + text.slice(match.end);
    onChange(composeDirection([...selected, preset], nextText));
    const caret = match.start;
    setMatch(undefined);
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(caret, caret); });
  };
  const remove = (id: string) => {
    onChange(composeDirection(selected.filter((preset) => preset.id !== id), text));
    requestAnimationFrame(() => ref.current?.focus());
  };
  const moveEmotion = (id: string, delta: number) => {
    const index = emotions.findIndex((preset) => preset.id === id);
    const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= emotions.length) return;
    const reordered = [...emotions];
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    onChange(composeDirection([...reordered, ...actions], text));
    requestAnimationFrame(() => ref.current?.focus());
  };
  const keyboard = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); onSave(); return; }
    if (match) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMatch(undefined); return; }
      if (choices.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length); return; }
      if (choices.length && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); choose(choices[Math.min(active, choices.length - 1)].id); return; }
    }
    if (event.key === 'Escape') onClose();
  };
  return <div className="direction-input">
    {!!emotions.length && <div className="direction-group">
      <small>{emotions.length > 1 ? 'Emotional progression' : 'Emotion'}</small>
      <div className="direction-badges emotion-sequence" aria-label="Emotional progression">
        {emotions.map((preset, index) => <span className="direction-sequence-item" key={preset.id}>
          {index > 0 && <span className="direction-arrow" aria-hidden="true">→</span>}
          <span className={`direction-badge ${preset.category}`}>
            <span>{preset.label}</span>
            {emotions.length > 1 && <span className="direction-order-controls">
              <button type="button" disabled={index === 0} aria-label={`Move ${preset.label} earlier`} title="Move earlier" onClick={() => moveEmotion(preset.id, -1)}>‹</button>
              <button type="button" disabled={index === emotions.length - 1} aria-label={`Move ${preset.label} later`} title="Move later" onClick={() => moveEmotion(preset.id, 1)}>›</button>
            </span>}
            <button type="button" aria-label={`Remove ${preset.label}`} title={`Remove ${preset.label}`} onClick={() => remove(preset.id)}>×</button>
          </span>
        </span>)}
      </div>
    </div>}
    {!!actions.length && <div className="direction-group">
      <small>{scope === 'framing' ? 'Camera' : 'Actions'}</small>
      <div className="direction-badges" aria-label={scope === 'framing' ? 'Camera presets' : 'Selected actions'}>
        {actions.map((preset) => <span className={`direction-badge ${preset.category}`} key={preset.id}>
          <span>{preset.label}</span>
          <button type="button" aria-label={`Remove ${preset.label}`} title={`Remove ${preset.label}`} onClick={() => remove(preset.id)}>×</button>
        </span>)}
      </div>
    </div>}
    <textarea ref={ref} autoFocus aria-label={label} aria-controls={match ? listId : undefined} aria-expanded={!!match} aria-autocomplete={scope === 'scene' ? undefined : 'list'} aria-activedescendant={match && choices.length ? `${listId}-${active}` : undefined}
      placeholder={scope === 'scene' ? 'Describe what happens in the scene…' : 'Type / to add emotions or motions…'} value={text}
      onChange={e => {
        const nextText = e.target.value;
        const inline = resolvePresets(nextText, scope).filter((preset) => !selectedIds.has(preset.id));
        onChange(composeDirection([...selected, ...inline], visibleDirectionText(nextText, scope)));
        updateQuery(nextText, e.target.selectionStart);
      }}
      onClick={e => updateQuery(text, e.currentTarget.selectionStart)} onKeyDown={keyboard} onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateQuery(text, e.currentTarget.selectionStart); }} />
    {match && <div className="preset-menu" role="listbox" id={listId} aria-label="Direction presets">
      {choices.length ? choices.map((p, i) => <button type="button" role="option" aria-selected={i === active} id={`${listId}-${i}`} key={p.id} className={i === active ? 'active' : ''} onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(p.id)}><span>{p.label}</span>{' '}<small>{p.category === 'emotion' ? 'Emotion' : p.category === 'camera' ? 'Camera' : 'Motion'}</small></button>) : <p>No presets found. Continue with a freeform description.</p>}
    </div>}
    {scope !== 'scene' && <small className="direction-hint">/ adds a preset. Multiple emotions create a progression in the order shown; use the arrows to reorder them. Use the text only for emotions that happen at the same time.</small>}
  </div>;
}

export function DirectionPreview({ value, scope }: { value: string; scope: TimelineCommentScope }) {
  const presets = resolvePresets(value, scope);
  const emotions = presets.filter((preset) => preset.category === 'emotion');
  const actions = presets.filter((preset) => preset.category !== 'emotion');
  const text = visibleDirectionText(value, scope);
  return <span className="direction-preview">
    {!!presets.length && <span className="direction-badges" aria-label="Saved presets">
      {emotions.map((preset, index) => <span className="direction-sequence-item" key={preset.id}>{index > 0 && <span className="direction-arrow" aria-hidden="true">→</span>}<span className={`direction-badge ${preset.category}`}>{preset.label}</span></span>)}
      {actions.map((preset) => <span className={`direction-badge ${preset.category}`} key={preset.id}>{preset.label}</span>)}
    </span>}
    {text && <span className="direction-preview-text">{text}</span>}
  </span>;
}
