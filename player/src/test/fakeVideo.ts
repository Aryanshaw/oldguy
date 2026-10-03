type Handler = (e?: unknown) => void;

export interface FakeVideo {
  src: string;
  currentTime: number;
  duration: number;
  readyState: number;
  paused: boolean;
  preload: string;
  blockPlay: boolean;
  playCalls: number;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  removeAttribute(name: string): void;
  addEventListener(name: string, fn: Handler): void;
  removeEventListener(name: string, fn: Handler): void;
  fire(name: 'canplay' | 'ended' | 'timeupdate' | 'error'): void;
  listenerCount(): number;
}

/** A stand-in for HTMLVideoElement that behaves like one where it matters: setting src resets time and pauses. */
export function makeFakeVideo(): FakeVideo {
  const handlers = new Map<string, Set<Handler>>();
  let src = '';
  const fake: FakeVideo = {
    get src() {
      return src;
    },
    set src(v: string) {
      src = v;
      fake.currentTime = 0;
      fake.paused = true;
      fake.readyState = 0;
    },
    currentTime: 0,
    duration: NaN,
    readyState: 0,
    paused: true,
    preload: 'none',
    blockPlay: false,
    playCalls: 0,
    load() {},
    play() {
      fake.playCalls++;
      if (fake.blockPlay) {
        const err = new Error('play() blocked');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      fake.paused = false;
      return Promise.resolve();
    },
    pause() {
      fake.paused = true;
    },
    removeAttribute(name: string) {
      if (name === 'src') fake.src = '';
    },
    addEventListener(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(fn);
    },
    removeEventListener(name, fn) {
      handlers.get(name)?.delete(fn);
    },
    fire(name) {
      if (name === 'ended') fake.paused = true;
      for (const fn of [...(handlers.get(name) ?? [])]) fn({ type: name });
    },
    listenerCount() {
      let n = 0;
      for (const s of handlers.values()) n += s.size;
      return n;
    },
  };
  return fake;
}

export const asVideo = (f: FakeVideo): HTMLVideoElement => f as unknown as HTMLVideoElement;
