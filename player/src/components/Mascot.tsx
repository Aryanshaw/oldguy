// Yap's mascot: an original wind-up alarm clock (bells on stalks, a striker, a dial with hands, feet and a winding
// key), drawn flat in the page's palette. The same drawing is docs/assets/mascot.svg, used by the README.
export function Mascot({ className = 'w-12' }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 140" className={className} aria-hidden="true" data-mascot>
      <g stroke="#14110A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M44 112l-10 16h14M96 112l10 16H92" fill="none" />
        <path d="M110 74h9" fill="none" />
        <rect x="119" y="58" width="12" height="32" rx="6" fill="#FF8A1F" />
        <path d="M44 36l-8-9M96 36l8-9M70 26V12" fill="none" />
        <circle cx="70" cy="10" r="4" fill="#14110A" />
        <path d="M14 30a22 22 0 0 1 34-22z" fill="#FF8A1F" transform="rotate(-8 31 19)" />
        <path d="M126 30a22 22 0 0 0-34-22z" fill="#FF8A1F" transform="rotate(8 109 19)" />
        <circle cx="70" cy="74" r="42" fill="#F6C945" />
        <circle cx="70" cy="74" r="31" fill="#FFF1CC" strokeWidth="4" />
      </g>
      <path d="M45 74h5M90 74h5M70 99v4" stroke="#FF8A1F" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="62" r="4.5" fill="#14110A" />
      <circle cx="80" cy="62" r="4.5" fill="#14110A" />
      <path d="M58 84q12 10 24 0" fill="none" stroke="#14110A" strokeWidth="4" strokeLinecap="round" />
      <path d="M70 74V50M70 74l10 5" stroke="#14110A" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="70" cy="74" r="3.5" fill="#14110A" />
    </svg>
  );
}
