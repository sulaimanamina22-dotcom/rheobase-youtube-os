// Rheobase chunked renderer: renders an episode in short pieces, each in a fresh browser, so a memory
// stall can only cost one piece. Finished pieces are kept; re-running resumes where it stopped.
// Usage: node engine/render-chunks.mjs <episodeDir> --to <sec> --name <name> [--chunk 60] [--score-db -10] [--limit-min 45]
// Writes renders/parts-<name>/p000.mp4 ..., joins them into renders/<name>-video.mp4, then mixes renders/<name>.mp4.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const epArg = args[0], epDir = path.resolve(epArg);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const to = +opt('to'), name = opt('name'), chunk = +opt('chunk', 60), scoreDb = opt('score-db', '-10'), limitMs = +opt('limit-min', 45) * 60000;
const FFMPEG = [path.join(ROOT, 'tools/ffmpeg.exe'), 'C:/Users/HP/AppData/Local/Programs/Stremio/ffmpeg.exe'].find((p) => fs.existsSync(p));
const parts = path.join(epDir, 'renders', 'parts-' + name); fs.mkdirSync(parts, { recursive: true });
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);

function runExport(extra, silenceMs = 360000) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(HERE, 'export.mjs'), epArg, ...extra], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', last = Date.now();
    const eat = (d) => { tail = (tail + d).slice(-1500); last = Date.now(); };
    p.stdout.on('data', eat); p.stderr.on('data', eat);
    const start = Date.now();
    const timer = setInterval(() => { // kill on a hard limit, or on 6 minutes of silence (a stalled browser)
      if (Date.now() - start > limitMs || Date.now() - last > silenceMs) { log('  stalled: killing this piece'); spawnSync('taskkill', ['/T', '/F', '/PID', String(p.pid)]); }
    }, 15000);
    p.on('close', (code) => { clearInterval(timer); ok({ code, tail }); });
  });
}

const edges = []; for (let a = 0; a < to - 1e-6; a += chunk) edges.push([a, Math.min(a + chunk, to)]);
for (let i = 0; i < edges.length; i++) {
  const [a, b] = edges[i], id = 'p' + String(i).padStart(3, '0'), done = path.join(parts, id + '.done');
  if (fs.existsSync(done)) { log(`${id} already done`); continue; }
  for (let attempt = 1; ; attempt++) {
    log(`${id} ${a} to ${b} s, attempt ${attempt}`);
    const rel = `renders/parts-${name}/${id}.mp4`;
    const r = await runExport(['--from', String(a), '--to', String(b), '--out', rel, '--frames-only', '--no-score']);
    const vid = path.join(parts, id + '-video.mp4');
    const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', vid], { encoding: 'utf8' }).stderr || '';
    if (r.code === 0 && /Duration/.test(probe)) {
      const errs = (r.tail.match(/SECTION ERRORS[\s\S]*/) || [''])[0];
      if (errs) { log('  ' + errs.slice(0, 900)); fs.appendFileSync(path.join(parts, 'section-errors.txt'), `${id}\n${errs}\n`); }
      fs.writeFileSync(done, 'ok'); log(`${id} done`); break;
    }
    log(`  failed (code ${r.code}): ${r.tail.slice(-300).replace(/\s+/g, ' ')}`);
    if (attempt >= 4) { log('giving up on ' + id); process.exit(1); }
  }
}
// join
const list = path.join(parts, 'list.txt');
fs.writeFileSync(list, edges.map((_, i) => `file 'p${String(i).padStart(3, '0')}-video.mp4'`).join('\n') + '\n');
const joined = path.join(epDir, 'renders', name + '-video.mp4');
log('joining');
const j = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], { encoding: 'utf8' });
if (j.status !== 0) { log('join failed: ' + j.stderr); process.exit(1); }
// narration + effects
log('mixing the sound');
const m = await runExport(['--from', '0', '--to', String(to), '--out', `renders/${name}.mp4`, '--audio-only', '--score-db', scoreDb], 2400000); // the mix prints nothing while it works
log(m.code === 0 ? 'finished: renders/' + name + '.mp4' : 'mix failed: ' + m.tail);
process.exit(m.code === 0 ? 0 : 1);
