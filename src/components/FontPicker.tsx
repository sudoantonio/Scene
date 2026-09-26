import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { FONT_OPTIONS, fontCss, type FontId } from '../domain/text-style';

export default function FontPicker({ value, onChange, name }: { value: FontId; onChange(font: FontId): void; name: string }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = FONT_OPTIONS.find((font) => font.id === value) ?? FONT_OPTIONS[0];

  useLayoutEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const trigger = root.current?.querySelector('.font-picker-trigger');
      if (!trigger) return;
      const bounds = trigger.getBoundingClientRect();
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const openAbove = below < 220 && above > below;
      setMenuStyle({
        position: 'fixed', left: bounds.left, width: bounds.width,
        ...(openAbove ? { bottom: window.innerHeight - bounds.top + 5 } : { top: bounds.bottom + 5 }),
        maxHeight: Math.max(100, Math.min(300, openAbove ? above - 5 : below - 5)),
      });
    };
    placeMenu();
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  return <div className="font-picker" ref={root}>
    <span className="font-picker-title">Font</span>
    <button type="button" className="font-picker-trigger" aria-label={name} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(!open)}>
      <span style={{ fontFamily: fontCss(value) }}>{selected.label}</span><ChevronDown size={13} />
    </button>
    {open && createPortal(<div ref={menu} className="font-picker-menu" role="listbox" aria-label={`${name} options`} style={menuStyle}>
      {FONT_OPTIONS.map((font) => <button key={font.id} type="button" role="option" aria-selected={font.id === value} className="font-picker-option" style={{ fontFamily: font.css }} onClick={() => { onChange(font.id); setOpen(false); }}>
        <span>{font.label}</span><span className="font-picker-sample">Aa 123</span>{font.id === value && <Check size={13} />}
      </button>)}
    </div>, document.querySelector('.app-shell') ?? document.body)}
  </div>;
}
