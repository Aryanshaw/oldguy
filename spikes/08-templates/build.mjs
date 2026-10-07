// Spike: one chapter in the peter-and-stewie template shape (stand-in art), built with the pieces the templates design
// relies on: per-speaker Kokoro voices, joined lines with gaps, estimated word times, and a 9:16 stage with speaker
// swaps, one-word captions and a slot. Usage: node build.mjs <python-of-a-kokoro-venv>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, 'out', 'wrong-lines');
const tpl = JSON.parse(fs.readFileSync(path.join(here, 'template', 'template.json'), 'utf8'));
const chapter = JSON.parse(fs.readFileSync(path.join(here, 'chapter.json'), 'utf8'));
const python = process.argv[2];
const HF = ['--yes', 'hyperframes@0.8.112'];
fs.mkdirSync(out, { recursive: true });

// Seconds of audio in a wav, from ffprobe.
function seconds(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
}

// 1. Each line in its speaker's voice and speed.
const voices = Object.fromEntries(tpl.speakers.map((s) => [s.id, s.voice]));
const lines = chapter.sentences.map((s, i) => {
  const txt = path.join(out, `line${i}.txt`);
  const wav = path.join(out, `line${i}.wav`);
  fs.writeFileSync(txt, s.text);
  execFileSync('npx', [...HF, 'tts', txt, '-o', wav, '--voice', voices[s.speaker], '--speed', String(tpl.pace.voice_speed[s.speaker]), '--json'],
    { env: { ...process.env, HYPERFRAMES_PYTHON: python }, stdio: 'pipe' });
  return { ...s, wav, dur: seconds(wav) };
});

// 2. Join the lines with the template's gap into one narration.wav, and place each line on the timeline.
const gap = tpl.pace.line_gap_ms / 1000;
const silence = path.join(out, 'gap.wav');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', String(gap), silence]);
const list = path.join(out, 'concat.txt');
fs.writeFileSync(list, lines.flatMap((l, i) => [`file '${l.wav}'`, ...(i < lines.length - 1 ? [`file '${silence}'`] : [])]).join('\n'));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '24000', '-ac', '1', path.join(out, 'narration.wav')]);
let t = 0;
for (const l of lines) { l.start = t; t += l.dur + gap; }
const total = Number((seconds(path.join(out, 'narration.wav')) + 0.3).toFixed(2));

// 3. Word times estimated inside each line from word length (no whisper): Kokoro leaves ~0.1 s at each end.
const words = [];
for (const [i, l] of lines.entries()) {
  const ws = l.text.split(/\s+/);
  const weight = ws.map((w) => w.replace(/[^\w']/g, '').length + 2);
  const sum = weight.reduce((a, b) => a + b, 0);
  const span = Math.max(0.2, l.dur - 0.2);
  let at = l.start + 0.1;
  ws.forEach((w, k) => { const d = (span * weight[k]) / sum; words.push({ line: i, w: w.replace(/[.,?!]$/, ''), start: at, end: at + d }); at += d; });
}
fs.writeFileSync(path.join(out, 'timing.json'), JSON.stringify({ lines: lines.map(({ wav, ...l }) => l), words }, null, 1));

// 4. The stage: 1080x1920, stand-in parkour background, the speaking character, one-word captions, and the slot.
const W = 1080, H = 1920;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const blocks = Array.from({ length: 40 }, (_, i) => {
  const x = i * 230, y = 1050 + ((i * 137) % 260), h = 70 + ((i * 53) % 60);
  return `<div class="blk" style="left:${x}px;top:${y}px;height:${h}px"></div>`;
}).join('');
const kid = `<svg viewBox="0 0 300 420" class="who" id="stewie"><ellipse cx="150" cy="120" rx="130" ry="95" fill="#F2C9A0" stroke="#14110A" stroke-width="8"/>
  <circle cx="105" cy="115" r="26" fill="#fff" stroke="#14110A" stroke-width="6"/><circle cx="195" cy="115" r="26" fill="#fff" stroke="#14110A" stroke-width="6"/>
  <circle cx="112" cy="120" r="8" fill="#14110A"/><circle cx="188" cy="120" r="8" fill="#14110A"/><path d="M110 170 q40 18 80 -6" stroke="#14110A" stroke-width="7" fill="none" class="mouth"/>
  <rect x="85" y="210" width="130" height="150" rx="20" fill="#D9342B" stroke="#14110A" stroke-width="8"/><rect x="85" y="210" width="130" height="50" fill="#F6C945" stroke="#14110A" stroke-width="8"/>
  <text x="150" y="405" text-anchor="middle" font-size="26" font-weight="900" fill="#fff" stroke="#14110A" stroke-width="5" paint-order="stroke">STAND-IN</text></svg>`;
const dad = `<svg viewBox="0 0 340 520" class="who" id="peter"><rect x="70" y="190" width="200" height="230" rx="60" fill="#fff" stroke="#14110A" stroke-width="8"/>
  <rect x="80" y="400" width="180" height="70" fill="#2F7D3A" stroke="#14110A" stroke-width="8"/><circle cx="170" cy="130" r="95" fill="#F2C9A0" stroke="#14110A" stroke-width="8"/>
  <circle cx="135" cy="115" r="22" fill="#fff" stroke="#14110A" stroke-width="5"/><circle cx="205" cy="115" r="22" fill="#fff" stroke="#14110A" stroke-width="5"/>
  <circle cx="135" cy="118" r="7" fill="#14110A"/><circle cx="205" cy="118" r="7" fill="#14110A"/><path d="M130 175 q40 22 80 0" stroke="#14110A" stroke-width="7" fill="none"/>
  <path d="M75 50 L170 15 L265 50 L170 85 Z" fill="#14110A"/><rect x="120" y="55" width="100" height="30" fill="#14110A"/><path d="M250 52 v45" stroke="#F6C945" stroke-width="6"/>
  <text x="170" y="505" text-anchor="middle" font-size="26" font-weight="900" fill="#fff" stroke="#14110A" stroke-width="5" paint-order="stroke">STAND-IN</text></svg>`;
const props = {
  check: (l) => `<div class="card"><div class="mono">$ oldguy reply --source cli/client.mts:141</div><div class="big ok">✓ ${esc(l)}</div></div>`,
  refused: (l) => `<div class="card bad"><div class="big">✗ ${esc(l)}</div><div class="mono">--source x.mts:90: past end of file</div></div>`,
  file: (l) => `<div class="card"><div class="file">${Array.from({ length: 8 }, () => '<i></i>').join('')}<b>line 90 →</b></div><div class="mono">${esc(l)}</div></div>`,
  ok: (l) => `<div class="card"><div class="big ok">✓ ${esc(l)}</div></div>`,
};
const slotHtml = chapter.slot.map((s, i) => `<div class="prop" id="prop${i}">${props[s.prop](s.label)}</div>`).join('');
const capHtml = words.map((w, i) => `<div class="cap" id="w${i}">${esc(w.w)}</div>`).join('');
const srcChips = lines.map((l, i) => (l.kind === 'claim'
  ? `<div class="src" id="src${i}">${l.source_ids.map((id) => { const s = chapter.sources.find((x) => x.id === id); return `${s.file}:${s.lines[0]}`; }).join(' · ')}</div>` : '')).join('');

const tl = [];
tl.push(`tl.to("#world", {x: -${230 * 40 - W}, duration: ${total}, ease: "none"}, 0);`);
for (const [i, l] of lines.entries()) {
  const other = l.speaker === 'peter' ? 'stewie' : 'peter';
  tl.push(`tl.set("#${l.speaker}", {opacity: 1}, ${l.start.toFixed(3)}); tl.set("#${other}", {opacity: 0}, ${l.start.toFixed(3)});`);
  tl.push(`tl.fromTo("#${l.speaker}", {y: 0}, {y: -14, duration: 0.18, repeat: ${Math.max(1, Math.floor(l.dur / 0.36) * 2 - 1)}, yoyo: true}, ${l.start.toFixed(3)});`);
  if (l.kind === 'claim') tl.push(`tl.set("#src${i}", {opacity: 1}, ${l.start.toFixed(3)}); tl.set("#src${i}", {opacity: 0}, ${(l.start + l.dur).toFixed(3)});`);
}
words.forEach((w, i) => tl.push(`tl.set("#w${i}", {opacity: 1, scale: 1.12}, ${w.start.toFixed(3)}); tl.to("#w${i}", {scale: 1, duration: 0.08}, ${w.start.toFixed(3)}); tl.set("#w${i}", {opacity: 0}, ${w.end.toFixed(3)});`));
chapter.slot.forEach((s, i) => {
  const line = lines[s.line];
  const kw = words.find((w) => w.line === s.line && w.w.toLowerCase().startsWith(s.on)) || words.find((w) => w.line === s.line);
  const end = s.line + 1 < lines.length ? lines[s.line + 1].start + lines[s.line + 1].dur : total;
  tl.push(`tl.fromTo("#prop${i}", {opacity: 0, scale: 0.4, rotation: -8}, {opacity: 1, scale: 1, rotation: 0, duration: 0.3, ease: "back.out(2.4)"}, ${kw.start.toFixed(3)});`);
  tl.push(`tl.to("#prop${i}", {opacity: 0, duration: 0.2}, ${Math.min(end, total - 0.2).toFixed(3)});`);
  void line;
});

const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=${W}, height=${H}" /><title>${chapter.id}</title>
<script src="gsap.min.js"></script>
<style>
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #8EC5FF; }
#root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
#sky { position: absolute; inset: 0; background: linear-gradient(#7FB6F5, #CFE6FF 55%, #6FAE4E 55%, #4E8A36); }
#world { position: absolute; left: 0; top: 0; width: ${230 * 40}px; height: ${H}px; }
.blk { position: absolute; width: 150px; background: #C97B3D; border: 6px solid #6B3B17; box-shadow: inset 0 18px 0 #E39A55; }
.who { position: absolute; bottom: 90px; width: 440px; opacity: 0; }
#stewie { left: 10px; } #peter { right: 0; width: 470px; }
.cap { position: absolute; left: 0; right: 0; top: 330px; text-align: center; font-size: 120px; font-weight: 900; color: #fff;
  -webkit-text-stroke: 10px #14110A; paint-order: stroke fill; opacity: 0; }
#slot { position: absolute; left: 90px; right: 90px; top: 560px; height: 520px; }
.prop { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0; }
.card { background: #FFF6DC; border: 8px solid #14110A; border-radius: 28px; padding: 36px 40px; box-shadow: 14px 14px 0 #14110A; max-width: 860px; }
.card.bad { background: #FFD3CC; }
.mono { font: 700 34px ui-monospace, Menlo, monospace; color: #14110A; }
.big { font-size: 76px; font-weight: 900; color: #D9342B; margin: 10px 0; } .big.ok { color: #1F8A3B; }
.file { display: grid; gap: 14px; margin-bottom: 18px; position: relative; } .file i { display: block; height: 18px; background: #C9BFA4; border-radius: 9px; }
.file b { display: block; text-align: right; font-size: 46px; color: #D9342B; }
.src { position: absolute; left: 0; right: 0; top: 1110px; text-align: center; font: 700 34px ui-monospace, Menlo, monospace; color: #14110A; opacity: 0; }
.src::before { content: "source  "; color: #6B3B17; }
</style></head><body>
<div id="root" data-composition-id="${chapter.id}" data-start="0" data-width="${W}" data-height="${H}" data-duration="${total}">
<div id="sky"></div><div id="world" data-layout-allow-overflow>${blocks}</div>
<div id="slot">${slotHtml}</div>${srcChips}
${capHtml}
${kid}${dad}
<audio id="narration" src="narration.wav" data-start="0" data-duration="${total}" data-track-index="10" data-volume="1"></audio>
</div>
<script>
const tl = gsap.timeline({ paused: true });
${tl.join('\n')}
window.__timelines[${JSON.stringify(chapter.id)}] = tl;
</script></body></html>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(here, '..', '..', 'scene-kit', 'vendor', 'gsap.min.js'), path.join(out, 'gsap.min.js'));
console.log(`lines: ${lines.length}, words: ${words.length}, duration: ${total}s`);
for (const l of lines) console.log(`  ${l.start.toFixed(2).padStart(6)}s  ${l.speaker.padEnd(6)} ${l.dur.toFixed(2)}s  ${l.text}`);
