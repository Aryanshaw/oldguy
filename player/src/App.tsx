export function Logo() {
  return (
    <div className="flex items-center gap-[18px]">
      <svg viewBox="0 0 100 100" className="w-[84px]" aria-hidden="true">
        <path
          d="M16 10h68a10 10 0 0 1 10 10v42a10 10 0 0 1-10 10H46L22 92V72h-6A10 10 0 0 1 6 62V20a10 10 0 0 1 10-10z"
          fill="#F6C945"
          stroke="#14110A"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <path d="M40 25l30 16-30 16z" fill="#14110A" stroke="#14110A" strokeWidth="4" strokeLinejoin="round" />
      </svg>
      <span className="bd sh -rotate-2 rounded-[6px] bg-yk-yellow px-[18px] pb-2 text-[76px] leading-none font-black tracking-[-0.04em]">
        yap
      </span>
    </div>
  );
}

export function App() {
  return (
    <main className="grid min-h-screen place-items-center">
      <Logo />
    </main>
  );
}
