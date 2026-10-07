import { Mascot } from './Mascot';

// The oldguy logo: the old guy's head next to the wordmark on a tilted yellow chip.
export function Logo({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const small = size === 'sm';
  return (
    <div className={small ? 'flex items-center gap-3' : 'flex items-center gap-[18px]'}>
      <Mascot className={small ? 'w-11 shrink-0' : 'w-[96px] shrink-0'} />
      <span
        className={
          small
            ? 'bd sh -rotate-2 rounded-[6px] bg-og-yellow px-3 pb-1 text-[34px] leading-none font-black tracking-[-0.04em]'
            : 'bd sh -rotate-2 rounded-[6px] bg-og-yellow px-[18px] pb-2 text-[76px] leading-none font-black tracking-[-0.04em]'
        }
      >
        oldguy
      </span>
    </div>
  );
}
