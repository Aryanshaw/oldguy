import { useEffect, useMemo, useState } from 'react';
import { ChatTab } from '@/components/ChatTab';
import { Controls } from '@/components/Controls';
import { ExportDialog } from '@/components/ExportDialog';
import { Header } from '@/components/Header';
import { Notice } from '@/components/Notice';
import { SourcesTab } from '@/components/SourcesTab';
import { Timeline } from '@/components/Timeline';
import { useCaptionsPref, usePlayer } from '@/components/usePlayer';
import { VideoStage } from '@/components/VideoStage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createStore, useStore } from '@/state/store';
import type { Manifest } from '@/types';

type Store = ReturnType<typeof createStore>;

function Page({ store, manifest, onExport }: { store: Store; manifest: Manifest; onExport: () => void }) {
  const chapters = manifest.chapters;
  const player = usePlayer(chapters);
  const [captionsOn, toggleCaptions] = useCaptionsPref();
  const [panelOpen, setPanelOpen] = useState(true);
  const claudeConnected = useStore(store, (s) => s.claudeConnected);
  const failReasons = useStore(store, (s) => s.failReasons);
  const sent = useStore(store, (s) => s.sent);
  const retried = useMemo(() => Object.keys(sent).filter((k) => k.startsWith('rt:')), [sent]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-4">
      <Header title={manifest.title} connected={claudeConnected} onExport={onExport} />
      <div
        data-layout
        className={`grid grid-cols-1 items-start gap-5 ${panelOpen ? 'min-[1000px]:grid-cols-[minmax(0,1fr)_360px]' : ''}`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <VideoStage player={player} chapters={chapters} captionsOn={captionsOn} />
          <Controls player={player} chapters={chapters} captionsOn={captionsOn} onToggleCaptions={toggleCaptions} />
          <Timeline
            chapters={chapters}
            position={player.position}
            failReasons={failReasons}
            broken={player.broken}
            retried={retried}
            onSeek={player.seek}
            onRetry={(id) => void store.press('retry_chapter', 'rt:' + id, { chapter_id: id, t: 0 }).catch(() => {})}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls="side-panel"
            onClick={() => setPanelOpen((v) => !v)}
            className="bd cursor-pointer self-end rounded-[10px] bg-yk-white px-3 py-1 text-xs font-black text-yk-black focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-yk-black"
          >
            {panelOpen ? 'Hide panel' : 'Show panel'}
          </button>
          {panelOpen && (
            <aside
              id="side-panel"
              // a fixed height, so a long chat scrolls inside the panel and the question box stays on screen
              className="bd sh-lg flex h-[min(760px,calc(100dvh-8rem))] min-h-[420px] flex-col gap-3 rounded-[14px] bg-yk-white p-3"
            >
              <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col gap-3">
                <TabsList>
                  <TabsTrigger value="chat">Chat</TabsTrigger>
                  <TabsTrigger value="sources">Sources</TabsTrigger>
                </TabsList>
                <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
                  <ChatTab store={store} position={player.position} chapters={chapters} />
                </TabsContent>
                <TabsContent value="sources" className="min-h-0 flex-1 overflow-y-auto">
                  <SourcesTab store={store} position={player.position} chapters={chapters} />
                </TabsContent>
              </Tabs>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

export function App({ store: injected }: { store?: Store } = {}) {
  const [store] = useState(() => injected ?? createStore());
  const [exporting, setExporting] = useState(false);
  const link = useStore(store, (s) => s.link);
  const error = useStore(store, (s) => s.error);
  const manifest = useStore(store, (s) => s.manifest);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return (
    <>
      <Notice link={link} error={error} onRetry={store.retry} />
      {manifest && <Page store={store} manifest={manifest} onExport={() => setExporting(true)} />}
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </>
  );
}
