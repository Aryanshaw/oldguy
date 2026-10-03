import type { Link } from '@/state/store';
import { Button } from '@/components/ui/button';

export function Notice({ link, error, onRetry }: { link: Link; error: string | null; onRetry: () => void }) {
  if (link === 'open') return null;
  if (link === 'reconnecting') {
    return (
      <div role="status" className="bd bg-yk-orange px-4 py-1 text-center text-xs font-black text-yk-black">
        Reconnecting
      </div>
    );
  }
  return (
    <div role={link === 'loading' ? 'status' : 'alert'} className="bd sh mx-auto my-6 flex w-fit max-w-[560px] flex-col items-center gap-3 rounded-[14px] bg-yk-white p-6 text-center font-black text-yk-black">
      {link === 'loading' && <p>Loading</p>}
      {link === 'error' && (
        <>
          <p className="break-words">{error}</p>
          <Button onClick={onRetry}>Try again</Button>
        </>
      )}
      {link === 'forbidden' && <p>This link has expired. Open the link printed by Yap again.</p>}
      {link === 'gone' && <p>Yap&apos;s server stopped. Run /yap again and open the new link.</p>}
    </div>
  );
}
