import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Logo } from './Logo';

export function Header({
  title,
  connected,
  onExport,
  label,
  remake,
}: {
  title: string;
  connected: boolean;
  onExport: () => void;
  /** "<template> · <shape>", shown under the title when the video records them. */
  label?: string;
  /** The Remake as… control, placed beside Export. */
  remake?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Logo size="sm" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-black text-og-black">{title}</h1>
        <p className="text-xs font-bold text-og-black/70">Ask the old guy. Claude yaps. You watch.</p>
        {label && (
          <p data-template-label className="mt-1 text-xs font-black text-og-black">
            {label}
          </p>
        )}
      </div>
      <span
        className={`bd rounded-full px-3 py-1 text-xs font-black text-og-black ${connected ? 'bg-og-yellow' : 'bg-og-white'}`}
      >
        {connected ? 'Claude connected' : 'Claude not connected'}
      </span>
      {remake}
      <Button variant="accent" onClick={onExport}>
        Export
      </Button>
    </header>
  );
}
