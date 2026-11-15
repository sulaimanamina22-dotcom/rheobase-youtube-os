# Build: animate, render, review

Read `memory/style.md` first, every time.

## The engine (built once, reused every episode)

The first episode has to build a small reusable engine in `engine/`:
- **Canvas renderer:** one HTML page that draws any moment of the film from a time value `t`, in plain JavaScript with no outside images or libraries. It provides shared helpers for ink lines with boil, paper grain, gouache fills, hatching, glow, stop-motion stepping, and camera zoom or pan with nested scenes.
- **Frame exporter:** headless Chrome or Edge (both are installed) steps through `t` frame by frame and saves exact frames. The renderer must never depend on real-time playback.
- **Sound effects (no music by default):** the Web Audio code renders offline (OfflineAudioContext) to a WAV file, timed to the narration. Follow the sound rules in `memory/style.md` (beds, layers, variations, space, phone-speaker check, measured levels). Before any long render, give the creator a 20 to 30 second sound test and report the measured levels, saying plainly that Claude did not hear it.
- **Encoder and mixer:** frames plus narration plus score go to a 1080p H.264 MP4. ffmpeg isn't installed system-wide. Use PyAV (already present in the old Production tools) or a portable ffmpeg, installed into this workspace. Ask before installing anything that isn't free.
- **Preview:** a live browser preview of any scene with a time scrubber, for fast iteration.

Engine quality, speed and render time aren't proven yet. Measure them on the first episode and say honestly what they are.

## Each episode

1. **Scene plan:** from `chain.md` and `audio/timing.json`, write `scenes.md`. Each scene gets its start and end words and times, what the subject does on which words, and its transition into the next scene.
2. **First 60 seconds first:** build and render the episode's actual opening minute, with narration and score. Review it yourself (see below), then **show the creator. Their approval of the look comes before the rest is built.** If they reject it, find out exactly why before changing anything.
3. **Build the rest** in the same style, a section at a time. Render and review each section before moving on.
4. **Assemble** the full episode: picture, narration and effects (music only where the creator asked for it), mixed with narration on top at about -14 LUFS.

Each episode's sources go in `episodes/<slug>/build/`, and renders go in `episodes/<slug>/renders/`.

## Reviewing your own work

Before showing anything to the creator:
- Extract frames at 4 fps or more and look at every transition closely. Contact sheets of single frames aren't enough for transitions.
- Check the questions that matter:
  - Is every transition connected?
  - Is there any text on screen?
  - Is the subject doing something on its narration cue?
  - Is the science drawn right?
  - Does any scene look like a slide?
  - Do colors or layouts repeat?
  - Does it actually look as good as the zoom-style demo?
- Fix what you find, then render again.
- When handing it over, state exactly what you checked (for example, "frames at 4 fps, all 31 transitions"). Say plainly that you didn't hear the audio.

A successful render isn't a finished scene. Only the creator's approval is.
