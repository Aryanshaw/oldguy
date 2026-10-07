import markUrl from '../assets/oldguy-mark.svg';

// oldguy's mascot: the old guy's head in a yellow disc (trucker cap, glasses on the cap, open mouth, ginger-and-grey
// beard). Traced from the concept art; the same drawing is docs/assets/mascot.svg, used by the README.
export function Mascot({ className = 'w-12' }: { className?: string }) {
  return <img src={markUrl} alt="" className={className} aria-hidden="true" data-mascot />;
}
