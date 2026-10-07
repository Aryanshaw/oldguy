import type { Link } from '@/state/store';
import { Button } from '@/components/ui/button';

export function Notice({ link, error, onRetry }: { link: Link; error: string | null; onRetry: () => void }) {
  if (link === 'open') return null;
  if (link === 'reconnecting') {
    return (
      <div role="status" className="bd bg-og-orange px-4 py-1 text-center text-xs font-black text-og-black">
        Reconnecting
      </div>
    );
  }
  return (
    <div role={link === 'loading' ? 'status' : 'alert'} className="bd sh mx-auto my-6 flex w-fit max-w-[560px] flex-col items-center gap-3 rounded-[14px] bg-og-white p-6 text-center font-black text-og-black">
      {link === 'loading' && <p>Loading</p>}
      {link === 'error' && (
        <>
          <p className="break-words">{error}</p>
          <Button onClick={onRetry}>Try again</Button>
        </>
      )}
      {link === 'forbidden' && <p>This link has expired. Open the link printed by oldguy again.</p>}
      {link === 'gone' && <p>oldguy&apos;s server stopped. Run /oldguy again and open the new link.</p>}
    </div>
  );
}
