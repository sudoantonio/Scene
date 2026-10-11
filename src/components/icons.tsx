import { forwardRef, type SVGProps } from 'react';
export * from 'lucide-react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string; absoluteStrokeWidth?: boolean };
const solidIcon = (name: string, paths: React.ReactNode) => {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ size = 18, strokeWidth: _width, absoluteStrokeWidth: _absolute, className = '', ...props }, ref) =>
    <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={`scene-icon scene-icon-${name} ${className}`} {...props} fill="currentColor" stroke="none">{paths}</svg>);
  Icon.displayName = name;
  return Icon;
};
export const Play = solidIcon('play', <path d="M7 4.8c0-.8.9-1.3 1.6-.9l12 7.2c.7.4.7 1.4 0 1.8l-12 7.2c-.7.4-1.6-.1-1.6-.9Z" />);
export const Pause = solidIcon('pause', <><rect x="5" y="4" width="5" height="16" rx="1" /><rect x="14" y="4" width="5" height="16" rx="1" /></>);
export const SkipBack = solidIcon('skip-back', <><rect x="4" y="5" width="3" height="14" rx=".7" /><path d="M19.5 5.2c.6-.4 1.5 0 1.5.8v12c0 .8-.9 1.2-1.5.8L9 12.8a.9.9 0 0 1 0-1.6Z" /></>);
export const SkipForward = solidIcon('skip-forward', <><rect x="17" y="5" width="3" height="14" rx=".7" /><path d="M4.5 5.2C3.9 4.8 3 5.2 3 6v12c0 .8.9 1.2 1.5.8L15 12.8a.9.9 0 0 0 0-1.6Z" /></>);
export const StepBack = solidIcon('step-back', <><rect x="6" y="6" width="2" height="12" rx=".5" /><path d="m17.6 6.7-7.2 4.5a.9.9 0 0 0 0 1.6l7.2 4.5c.6.4 1.4 0 1.4-.8v-9c0-.8-.8-1.2-1.4-.8Z" /></>);
export const StepForward = solidIcon('step-forward', <><rect x="16" y="6" width="2" height="12" rx=".5" /><path d="m6.4 6.7 7.2 4.5a.9.9 0 0 1 0 1.6l-7.2 4.5c-.6.4-1.4 0-1.4-.8v-9c0-.8.8-1.2 1.4-.8Z" /></>);
export const Record = solidIcon('record', <circle cx="12" cy="12" r="7" />);
export const Stop = solidIcon('stop', <rect x="5" y="5" width="14" height="14" rx="2" />);
export const Pencil = solidIcon('pencil', <><path d="m4.8 15.3-1.3 5.2 5.2-1.3L18.4 9.5l-3.9-3.9Zm-1.3 5.2 1.7-3.7 2 2Z" /><path d="m16 4.1 1.1-1.1a2 2 0 0 1 2.8 0L21 4.1a2 2 0 0 1 0 2.8L19.9 8Z" /></>);
export const Music2 = solidIcon('music', <><path d="M10 4.2 21 2v14h-2V6.8l-9 1.8V19H8V5.7c0-.7.5-1.3 2-1.5Z" /><ellipse cx="6.5" cy="19" rx="3.5" ry="3" /><ellipse cx="17.5" cy="16" rx="3.5" ry="3" /></>);
export const Video = solidIcon('video', <><rect x="2" y="5" width="14" height="14" rx="2.5" /><path d="m18 8.3 3-2c.5-.3 1 .1 1 .7v10c0 .6-.5 1-1 .7l-3-2Z" /></>);
