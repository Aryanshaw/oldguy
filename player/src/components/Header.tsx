import { Button } from '@/components/ui/button';
import { Logo } from './Logo';
import { Mascot } from './Mascot';

export function Header({ title, connected, onExport }: { title: string; connected: boolean; onExport: () => void }) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Logo size="sm" />
      <Mascot className="-ml-2 w-11 shrink-0 rotate-6" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-black text-yk-black">{title}</h1>
        <p className="text-xs font-bold text-yk-black/70">Claude yaps. You watch.</p>
      </div>
      <span
        className={`bd rounded-full px-3 py-1 text-xs font-black text-yk-black ${connected ? 'bg-yk-yellow' : 'bg-yk-white'}`}
      >
        {connected ? 'Claude connected' : 'Claude not connected'}
      </span>
      <Button variant="accent" onClick={onExport}>
        Export
      </Button>
    </header>
  );
}
