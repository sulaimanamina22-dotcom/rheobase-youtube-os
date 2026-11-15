# Rheobase engine

Built November 7, 2026, on the first episode (Fall Into Jupiter). Everything is code-drawn; there are no outside images, samples or libraries.

| File | What it does |
|---|---|
| `core.js` | Shared helpers: seeded noise, stop-motion stepping (drawings on twos, 15 per second), boiled ink lines, tileable gouache and streak textures, hatching, glow, paper grain and vignette, camera, starfield, and nested-scene base matrix. |
| `render.html` | Headless render page. Loads an episode's `build/subjects.js`, `scenes.js` and `score.js`; exposes `renderAt(t)`, `frameJPEG(t)` and `renderScoreWAV(from, to)`. |
| `export.mjs` | Node 24 exporter. It drives headless Chrome over CDP with no installs, steps `t` frame by frame, and pipes exact frames to ffmpeg (libx264, CRF 16). It renders the score offline and mixes narration plus score (score at -14 dB, then loudnorm to -14 LUFS, true peak -1.5 dB). |
| `preview.html` | Scrubber and playback for checking any moment by eye. |

## Commands (from the workspace root)

```
node engine/export.mjs episodes/<slug> --stills 1,5.5,10          # quick stills to renders/stills
node engine/export.mjs episodes/<slug> --from 0 --to 70.88 --out renders/opening-v2.mp4
```

Then review: `ffmpeg -i <cut>.mp4 -vf fps=4 ...` and look at every transition.

## Measured on this PC (Intel UHD 620, 8 GB)

- About 5 frames per second at 1920x1080, so about 7 minutes per minute of film. A 10-minute episode is about 70 minutes of rendering, which can be done in sections.
- ffmpeg: the Stremio copy at `C:/Users/HP/AppData/Local/Programs/Stremio/ffmpeg.exe` (4.4: needs an explicit `aformat` at the end of audio filter chains). A copy at `tools/ffmpeg.exe` is used first if present.
