// The one place oldguy names the Hyperframes version it runs; Phase 0 measured this version (tts reported v0.8.112).
const HYPERFRAMES_VERSION = '0.8.112';

// Arguments for `npx` that run the pinned Hyperframes without an install prompt: npx --yes hyperframes@<version> <args>.
function hyperframesArgs(args: string[]): string[] {
  return ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args];
}

export { HYPERFRAMES_VERSION, hyperframesArgs };
