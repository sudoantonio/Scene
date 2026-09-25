import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export default function InspectorGroup({ title, children, defaultOpen = false, hint, icon, collapsible = true, variant }: { title: string; children: ReactNode; defaultOpen?: boolean; hint?: string; icon?: ReactNode; collapsible?: boolean; variant?: 'primary' | 'secondary' | 'setup' }) {
  const [open, setOpen] = useState(defaultOpen);
  const className = `inspector-group ${variant ? `inspector-group-${variant}` : ''}`;
  if (!collapsible) return <section className={`${className} inspector-group-fixed`}>
    <div className="inspector-group-summary">{icon && <i className="inspector-group-icon" aria-hidden="true">{icon}</i>}<span>{title}</span>{hint && <small>{hint}</small>}</div>
    <div className="inspector-group-body">{children}</div>
  </section>;
  return <details className={className} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight className="inspector-group-chevron" size={14} />{icon && <i className="inspector-group-icon" aria-hidden="true">{icon}</i>}<span>{title}</span>{hint && <small>{hint}</small>}</summary>
    <div className="inspector-group-body">{children}</div>
  </details>;
}
