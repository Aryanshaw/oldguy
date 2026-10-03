import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Position } from '@/lib/timeline';
import type { createStore } from '@/state/store';
import { useStore } from '@/state/store';
import type { Chapter } from '@/types';

const LIMIT = 4000;
const COUNTER_FROM = 3500;
const WRAP = 'break-words [overflow-wrap:anywhere]';

interface Props {
  store: ReturnType<typeof createStore>;
  position: Position | null;
  chapters: Chapter[];
}

export function ChatTab({ store, position, chapters }: Props) {
  const thread = useStore(store, (s) => s.thread);
  const connected = useStore(store, (s) => s.claudeConnected);
  const sent = useStore(store, (s) => s.sent);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  let lastClaude = -1;
  thread.forEach((e, i) => {
    if (e.role === 'claude') lastClaude = i;
  });
  const asking = chapters.filter((c) => c.status === 'rendering' && c.question);

  const press = (kind: 'make_video' | 'just_text', key: string, ctx?: { chapter_id: string; t: number }) => {
    store.press(kind, key, ctx).catch(() => {});
  };

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await store.ask(body, position ? { chapter_id: position.chapterId, t: position.offset } : undefined);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!connected && (
        <p className="bd rounded-[10px] bg-yk-orange px-3 py-2 text-xs font-black">
          Claude isn't connected: run /yap resume in Claude Code
        </p>
      )}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {thread.length === 0 && <p className="text-sm font-bold opacity-70">Ask about anything in this video.</p>}
        {thread.map((e, i) =>
          e.role === 'viewer' ? (
            <div key={e.id} data-role="viewer" className="flex max-w-[88%] flex-col items-end gap-1 self-end">
              <p
                className={`bd rounded-[14px_14px_2px_14px] bg-yk-yellow px-3 py-2 text-[13.5px] font-bold whitespace-pre-wrap ${WRAP}`}
              >
                {e.text}
              </p>
              {!connected && i > lastClaude && <span className="text-[11px] font-bold opacity-60">waiting</span>}
            </div>
          ) : (
            <div key={e.id} data-role="claude" className="flex flex-col gap-2">
              <div className="bd flex flex-col gap-2 rounded-[14px_14px_14px_2px] bg-yk-white px-3 py-2.5 sh">
                <p className={`text-[13.5px] leading-normal whitespace-pre-wrap ${WRAP}`}>{e.text}</p>
                {e.sources && e.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {e.sources.map((s, j) => (
                      <span
                        key={j}
                        className={`rounded-[4px] bg-[#FFD9A8] px-1.5 py-0.5 font-mono text-[11px] font-bold ${WRAP}`}
                      >{`${s.file}:${s.lines}`}</span>
                    ))}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="plain"
                className="self-start"
                disabled={!!sent[`mv:${e.id}`]}
                onClick={() => press('make_video', `mv:${e.id}`, e.context)}
              >
                {sent[`mv:${e.id}`] ? 'Asked for a video' : 'Make this a video'}
              </Button>
            </div>
          ),
        )}
        {asking.map((c) => (
          <div key={c.id} className="bd flex flex-col gap-2 rounded-[10px] bg-yk-cream px-3 py-2">
            <p className={`text-xs font-bold ${WRAP}`}>Making a chapter for: {c.question}</p>
            <Button
              size="sm"
              variant="plain"
              className="self-start"
              disabled={!!sent[`jt:${c.id}`]}
              onClick={() => press('just_text', `jt:${c.id}`, { chapter_id: c.id, t: 0 })}
            >
              {sent[`jt:${c.id}`] ? 'Asked for text' : 'Just text'}
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Your question"
            value={text}
            maxLength={LIMIT}
            rows={2}
            onChange={(ev) => setText(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                ev.preventDefault();
                void send();
              }
            }}
            className="bd min-h-[44px] w-full resize-none rounded-[10px] bg-yk-white px-3 py-2 text-sm font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-yk-black"
          />
          <Button variant="accent" disabled={busy || !text.trim()} onClick={() => void send()}>
            Ask
          </Button>
        </div>
        {text.length > COUNTER_FROM && (
          <span className="self-end text-[11px] font-bold tabular-nums">{`${text.length}/${LIMIT}`}</span>
        )}
        {error && (
          <p role="alert" className={`bd rounded-[10px] bg-yk-red px-3 py-1.5 text-xs font-bold text-yk-black ${WRAP}`}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
