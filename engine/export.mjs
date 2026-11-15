// Rheobase exporter: drives headless Chrome over CDP, steps t frame by frame,
// pipes exact frames to ffmpeg, renders the score offline, and muxes.
// Usage:
//   node engine/export.mjs <episodeDir> [--from 0] [--to <sec>] [--fps 30] [--out renders/name.mp4]
//          [--frames-only] [--stills 1,5.5,10] [--audio-only]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const FFMPEG = [path.join(ROOT, 'tools/ffmpeg.exe'), 'C:/Users/HP/AppData/Local/Programs/Stremio/ffmpeg.exe'].find((p) => fs.existsSync(p));

const args = process.argv.slice(2);
const epDir = path.resolve(args[0]);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const FPS = +opt('fps', 30);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const prof = path.join(process.env.TEMP || '.', 'rheobase-chrome-' + port);
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--window-size=1920,1080',
    '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', '--allow-file-access-from-files', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 100; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {} await sleep(150); }
  const page = list.find((p) => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
  const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  const url = pathToFileURL(path.join(HERE, 'render.html')).href + '?ep=' + encodeURI(pathToFileURL(path.join(epDir, 'build')).href);
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) { await sleep(150); try { if (await evalJS('document.readyState') === 'complete') break; } catch {} }
  await evalJS('window.ready');
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown');
  if (errs.length) console.error('page errors:', JSON.stringify(errs).slice(0, 1500));
  return { evalJS, close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

const b = await launch();
const dur = await b.evalJS('DURATION');
const from = +opt('from', 0), to = +opt('to', dur);
const rendersDir = path.join(epDir, 'renders'); fs.mkdirSync(rendersDir, { recursive: true });

if (opt('stills')) { // quick stills for review
  const dir = path.join(rendersDir, 'stills'); fs.mkdirSync(dir, { recursive: true });
  for (const s of opt('stills').split(',').map(Number)) {
    const b64 = await b.evalJS(`frameJPEG(${s}, 0.9)`);
    fs.writeFileSync(path.join(dir, `t${s.toFixed(2).padStart(6, '0')}.jpg`), Buffer.from(b64, 'base64'));
  }
  console.log('stills written to', dir); b.close(); process.exit(0);
}

const tag = opt('out', `renders/cut-${from}-${to}.mp4`);
const outMp4 = path.resolve(epDir, tag);
const silent = outMp4.replace(/\.mp4$/, '-video.mp4');
const scoreWav = outMp4.replace(/\.mp4$/, '-score.wav');

if (!flag('audio-only')) {
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n0 = Math.round(from * FPS), n1 = Math.round(to * FPS);
  const t0 = Date.now();
  for (let n = n0; n < n1; n++) {
    const b64 = await b.evalJS(`frameJPEG(${(n / FPS).toFixed(5)}, 0.94)`);
    const buf = Buffer.from(b64, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((n - n0) % 60 === 0) { const el = (Date.now() - t0) / 1000; console.log(`frame ${n - n0}/${n1 - n0}  ${((n - n0) / Math.max(el, 0.001)).toFixed(2)} fps`); }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('video done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const secErr = await b.evalJS('JSON.stringify(window.__SEC_ERR || [])'); if (secErr !== '[]') { const list = JSON.parse(secErr); console.log('SECTION ERRORS:', list.length); list.slice(0, 40).forEach((x) => console.log('  ' + x)); }
}

// score: rendered offline in the page
const has = !flag('no-score') && await b.evalJS('typeof renderScoreWAV === "function"');
if (has) {
  const b64 = await b.evalJS(`renderScoreWAV(${from}, ${to})`);
  fs.writeFileSync(scoreWav, Buffer.from(b64, 'base64'));
  console.log('score written', scoreWav);
}
b.close();

if (!flag('frames-only')) {
  const narr = path.join(epDir, 'audio', 'narration.wav');
  const inputs = ['-i', silent, '-ss', String(from), '-t', String(to - from), '-i', narr];
  let filter = '[1:a]aformat=sample_rates=48000:channel_layouts=stereo[n]';
  if (has) { inputs.push('-i', scoreWav); filter += `;[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${opt('score-db', '-14')}dB[s];[n][s]amix=inputs=2:normalize=0[m];[m]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]`; }
  else filter += ';[n]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]';
  await new Promise((ok, bad) => {
    const p = spawn(FFMPEG, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', outMp4], { stdio: 'inherit' });
    p.on('close', (c) => (c ? bad(new Error('ffmpeg mux failed ' + c)) : ok()));
  });
  console.log('wrote', outMp4);
}
process.exit(0);
