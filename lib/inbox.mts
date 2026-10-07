// Which viewer events still wait for Claude: every event that has neither a reply nor an ack, oldest first.
// yap listen prints these, so an event is shown again after a restart until Claude has handled it, and never after.
import { readEventsAfter, readThread, readAcks } from './events.mts';
import type { ViewerEvent } from './events.mts';

// The three chat files of one video folder.
type ChatFiles = { eventsFile: string; threadFile: string; acksFile: string };

// Returns the open events in the order they were asked; broken lines in any file are skipped by the readers.
function openEvents({ eventsFile, threadFile, acksFile }: ChatFiles): ViewerEvent[] {
  const handled = new Set<string>();
  for (const reply of readThread(threadFile)) handled.add(reply.in_reply_to);
  for (const ack of readAcks(acksFile)) handled.add(ack.event_id);
  return readEventsAfter(eventsFile, null).filter((e) => !handled.has(e.id));
}

export { openEvents };
export type { ChatFiles };
