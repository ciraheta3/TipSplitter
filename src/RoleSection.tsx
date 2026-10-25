import { useId } from 'react';
import type { ReactNode } from 'react';

export default function RoleSection({ name, selected, eligible, expanded, onToggle, children }: {
  name: string; selected: number; eligible: number; expanded: boolean; onToggle: () => void; children: ReactNode;
}) {
  const prefix = useId();
  return <section className="rounded border min-w-0">
    <h4>
      <button type="button" id={`${prefix}-toggle`} aria-expanded={expanded} aria-controls={`${prefix}-content`}
        onClick={onToggle} className="flex w-full min-h-12 items-center gap-3 rounded px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-blue-700">
        <span aria-hidden="true" className="shrink-0">{expanded ? '▾' : '▸'}</span>
        <span className="font-semibold min-w-0 break-words">{name}</span>{' '}
        <span className="ml-auto text-sm shrink-0">{selected} / {eligible} selected</span>
      </button>
    </h4>
    <div id={`${prefix}-content`} aria-labelledby={`${prefix}-toggle`} hidden={!expanded} className="p-2 pt-0 space-y-2">
      {expanded && children}
    </div>
  </section>;
}
