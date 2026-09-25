import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Box, Camera, Circle, Cone, Cylinder, Image, MoveRight, SquareDashed, TextCursorInput, Smile } from 'lucide-react';
import { presetsForScope } from '../domain/direction-presets';
import { sceneTargetBefore } from '../domain/scene-direction';
import type { SceneObject } from '../domain/schema';

type Suggestion = { kind: 'mention' | 'preset'; start: number; end: number; query: string };

function ChoiceIcon({ kind, objectKind }: { kind: 'mention' | 'preset'; objectKind: string }) {
  if (kind === 'preset') return objectKind === 'Camera' ? <Camera size={14} /> : objectKind === 'Emotion' ? <Smile size={14} /> : <MoveRight size={14} />;
  const icons = { camera: Camera, cube: Box, sphere: Circle, cylinder: Cylinder, cone: Cone, plane: SquareDashed, text: TextCursorInput, screen_image: Image };
  const Icon = icons[objectKind as keyof typeof icons] ?? Box;
  return <Icon size={14} />;
}

export default function SceneDirectionInput({ value, onChange, targets, selectedId }: {
  value: string; onChange(value: string): void; targets: SceneObject[]; selectedId?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [suggestion, setSuggestion] = useState<Suggestion>();
  const [active, setActive] = useState(0);
  const target = suggestion?.kind === 'preset' ? sceneTargetBefore(value, suggestion.start, targets, selectedId) : undefined;
  const choices = suggestion?.kind === 'mention'
    ? targets.filter((candidate) => `${candidate.name} ${candidate.kind === 'camera' ? 'camera' : 'element'}`.toLowerCase().includes(suggestion.query.trim().toLowerCase())).map((candidate) => ({ id: candidate.id, label: candidate.name, kind: candidate.kind === 'camera' ? 'Camera' : 'Element', objectKind: candidate.kind }))
    : suggestion?.kind === 'preset' && target
      ? presetsForScope(target.kind === 'camera' ? 'framing' : 'object').filter((preset) => `${preset.label} ${preset.id}`.toLowerCase().includes(suggestion.query.toLowerCase())).map((preset) => ({ id: preset.id, label: preset.label, kind: preset.category === 'camera' ? 'Camera' : preset.category === 'emotion' ? 'Emotion' : 'Motion', objectKind: preset.category }))
      : [];

  const updateSuggestion = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const slash = before.match(/(?:^|\s)\/([a-z0-9-]*)$/i);
    const mention = before.match(/(?:^|\s)@([^@\n/]*)$/);
    if (slash) setSuggestion({ kind: 'preset', start: caret - slash[1].length - 1, end: caret, query: slash[1] });
    else if (mention) setSuggestion({ kind: 'mention', start: caret - mention[1].length - 1, end: caret, query: mention[1] });
    else setSuggestion(undefined);
    setActive(0);
  };
  const choose = (index: number) => {
    if (!suggestion || !choices[index]) return;
    const item = choices[index];
    const inserted = suggestion.kind === 'mention' ? `@${item.label}` : `/${item.id}`;
    const tail = value.slice(suggestion.end);
    const spacer = !tail || !/^\s|[.,;:!?]/.test(tail) ? ' ' : '';
    onChange(value.slice(0, suggestion.start) + inserted + spacer + tail);
    const caret = suggestion.start + inserted.length + spacer.length;
    setSuggestion(undefined);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(caret, caret); });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (!suggestion) return;
    if (event.key === 'Escape') { event.preventDefault(); setSuggestion(undefined); return; }
    if (choices.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
    } else if (choices.length && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault(); choose(Math.min(active, choices.length - 1));
    }
  };
  return <div className="scene-direction-input">
    <textarea ref={input} aria-label="Scene direction" aria-controls={suggestion ? listId : undefined} aria-expanded={Boolean(suggestion)} aria-autocomplete="list" aria-activedescendant={suggestion && choices.length ? `${listId}-${Math.min(active, choices.length - 1)}` : undefined}
      value={value} placeholder="Describe the scene… Use @ for elements and / for motions"
      onChange={(event) => { onChange(event.target.value); updateSuggestion(event.target.value, event.target.selectionStart); }}
      onClick={(event) => updateSuggestion(value, event.currentTarget.selectionStart)}
      onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateSuggestion(value, event.currentTarget.selectionStart); }} onKeyDown={onKeyDown} />
    {suggestion && <div className="scene-direction-menu" role="listbox" id={listId} aria-label={suggestion.kind === 'mention' ? 'Scene elements' : 'Motion presets'}>
      {choices.length ? choices.map((choice, index) => <button key={choice.id} type="button" role="option" id={`${listId}-${index}`} aria-label={`${choice.label} ${choice.kind}`} aria-selected={index === active} className={index === active ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}><ChoiceIcon kind={suggestion.kind} objectKind={suggestion.kind === 'mention' ? choice.objectKind : choice.kind} /><span>{choice.label}</span><small>{choice.kind}</small></button>) : <p>{suggestion.kind === 'preset' && !target ? 'Mention a camera or element with @ first.' : 'No matches found.'}</p>}
    </div>}
  </div>;
}
