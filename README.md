# Rheobase YouTube OS

An AI production system that takes a YouTube science explainer from idea to finished video: topic research, script, fact-check, voiceover, **code-drawn animation**, sound mix and final render. No stock footage, no outside images. Every frame is drawn by code.

**Made with it:** [What If You Fell Into Jupiter?](https://youtu.be/VHdaeZyko9o) on the [Rheobase channel](https://www.youtube.com/@Rheobase)

[![What If You Fell Into Jupiter?](https://i.ytimg.com/vi/VHdaeZyko9o/hqdefault.jpg)](https://youtu.be/VHdaeZyko9o)

## How it works

```
Idea  ->  Script  ->  Voice  ->  Build (animate)  ->  Publish
```

| Stage | What happens | File |
|---|---|---|
| Idea | Finds topics with proven demand (small-channel breakouts, search data) and pitches them | `workflows/idea.md`, `scripts/demand.py`, `scripts/outliers.py` |
| Script | Researches, writes and fact-checks every claim against an opened source | `workflows/script.md` |
| Voice | Records the narrator and aligns words to time with local Whisper | `workflows/voice.md`, `scripts/transcribe.py` |
| Build | Writes the scene chain, then animates each scene in code with connected zooms and morphs | `workflows/build.md`, `engine/` |
| Publish | Full-cut review, title and thumbnail | `workflows/publish.md` |

The creator approves at four points: topic, script, first 60 seconds, and final cut. Between those, the AI works on its own.

## The animation engine (`engine/`)

- **`core.js` + `look/`**: hand-made ink-and-paper look in pure JavaScript: seeded noise, "boiled" ink lines, gouache textures, hatching, glow, paper grain, camera, planets, characters, lighting.
- **`render.html`**: headless render page that draws any frame at time `t` and renders the music score to WAV.
- **`export.mjs`**: Node exporter. Drives headless Chrome over CDP frame by frame, pipes frames to ffmpeg (x264), and mixes narration and score to -14 LUFS.
- **`preview.html`**: scrubber for checking any moment by eye.

```bash
node engine/export.mjs episodes/<slug> --stills 1,5.5,10
node engine/export.mjs episodes/<slug> --from 0 --to 70 --out renders/opening.mp4
```

## Rules the OS enforces

1. **Original or nothing**: no reused footage, clips, music or scripts.
2. **True**: every factual claim is checked against a real source, or cut.
3. **Watch it before calling it done**: judge the rendered output, not the code.
4. **Plan before building**: the scene chain is written before any code.

## Run it

Open the folder as a project in Claude Code (or any LLM with file access). The AI reads `AGENTS.md` first; that file is the whole OS.

## Tech

JavaScript (Canvas), Node.js, headless Chrome (CDP), ffmpeg, Python, local Whisper.

*Episode media, model weights and channel notes are kept out of this repo.*
