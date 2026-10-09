// The Kokoro voices a template may name, exactly as the pinned Hyperframes lists them (`hyperframes tts --list`).
// A test compares this list with the program's own when OLDGUY_CHECK_VOICES is set (it needs the network).

const KOKORO_VOICES: readonly string[] = [
  'af_heart', 'af_nova', 'af_sky', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george',
  'ef_dora', 'ff_siwis', 'jf_alpha', 'zf_xiaobei',
];

// The voice a template with no speakers narrates in when it names none (today's narrator).
const DEFAULT_NARRATOR_VOICE = 'af_heart';

// Reads the voice ids out of the table `hyperframes tts --list` prints: the first word of each row that looks like an id.
function parseVoiceList(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s+([a-z]{2}_[a-z0-9]+)\s/.exec(line);
    if (m) ids.push(m[1]);
  }
  return ids;
}

export { KOKORO_VOICES, DEFAULT_NARRATOR_VOICE, parseVoiceList };
