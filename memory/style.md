# Rheobase style: the zoom style

Decided November 5, 2026. Reference: the creator's demo `C:/Users/HP/Downloads/the zoom style.mp4`, a 32-second screen recording, posted on X, of an Opus 5.5 test that drew stop-motion scenes in HTML and JavaScript. It includes the poster's facecam and cursor, which aren't part of the style. We adapt its approach into our own look and never copy its scenes or its creature.

## The core idea

**Every scene turns into the next one.** The camera zooms through a detail, or a shape morphs into the next subject, so the whole episode feels like one connected journey. This is the channel's signature, and it mirrors the Vsauce-style chain of ideas: when the idea connects, the picture connects.

What the demo actually does (studied at 1 and 4 frames per second):
- The camera pushes into a creature's eye. The pupil opens into a galaxy.
- A glowing star in that galaxy becomes a neuron's cell body. The neuron fires down its axon.
- The neuron's branching becomes lightning, through a brief black-ink-on-paper drawing of the same branching shape.
- Light through a prism becomes a spectrum, the spectrum becomes a DNA double helix, and the helix coils into a spiral.
- The spiral becomes the seed pattern of a sunflower. The seeds lift off as a murmuration of starlings. The flock settles into a spiral galaxy, and the galaxy collapses into a black hole.
- A warp-speed streak becomes a rocket launch, then Earth seen over the Moon, then a colorful fractal, and the loop returns to the start.

The lesson: the transitions are **visual rhymes**. A shape (a circle, branching, a spiral, a swarm, a glow) carries over from one subject into the next.

## Transitions

- **Every transition is connected:** a zoom through a detail, a shape morph, or a match on a shared shape, color or motion.
- A hard cut is allowed only as a rare, deliberate dramatic beat. Never use one because it's easier.
- Each transition should mean something. Ideally the visual link is also the idea link in the narration.
- Keep the viewer oriented. Make it clear when a change is a literal change of scale (zooming into a real cell) and when it's a metaphor (a neuron becoming lightning). Never imply something false, such as galaxies physically existing inside atoms.
- Vary the transition types, so the episode doesn't repeat one trick for ten minutes.

## Look

- **Current look: Kurzgesagt-style flat** (creator approved November 15, 2026, on the lightning strike style frame; study: `outputs/2026-11-15-kurzgesagt-look-study/study.md`). This replaces the ink-outline and paper-grain rules below and in the sections further down wherever they conflict:
  - no outlines; shapes are separated by colour and value;
  - every object is 2 or 3 flat tones (shadow, base, a lit band) with crisp edges, and no paint texture or grain;
  - clouds and smoke are stacked flat puffs, but their real structure stays right;
  - detail comes from repeated simple shapes;
  - glows only on things that emit light;
  - deep purple, indigo and teal grounds, with one hot accent per shot.
  - The code is `episodes/2026-11-13-lightning/build/sections/kzlook.js`, `kzsky.js`, `kzthings.js` and `kzcells.js`.
- **Drawn entirely by code** on an HTML canvas: shapes, textures, grain and lighting. No photos, stock footage, or other people's images in the picture.
- **Hand-made feel:** ink outlines with slight line boil, flat color fills, visible paper grain, gouache texture, crosshatching for shading, torn-paper edges where they help, and selective glow on what matters.
- **Soft stop-motion cadence** for drawn elements, roughly 12 drawings per second inside a 24 or 30 fps video. Camera moves can be smooth. It should never look like glossy CGI.
- **Bold, scene-specific color** taken from the demo's range:
  - deep indigo or navy night scenes with warm glowing accents;
  - peach and violet sunset skies;
  - clean off-white paper scenes with black ink;
  - saturated rainbow accents for light, DNA and fractals.

  No muted beige-everything, no fixed brand colors, and no single background color repeated through the episode.
- **Recognizable subjects with real structure:** a neuron has dendrites, a cell body and an axon; a black hole has its accretion disk. Draw from real references so the science is right, then stylize.
- **Something is always happening:** every scene has the subject doing something (firing, flowing, growing, colliding), timed to the narration. Never a static picture with one arrow moving. Never a slide.

## Lessons from the first rejected opening (November 7, 2026)

The creator rejected Fall Into Jupiter's opening-v2: "no viewer will stay for a second on this." It held one composition (a muddy banded planet on navy, with tiny specks for the subjects) for most of a minute. These rules come from comparing it with the zoom demo, the Vox, Cleo Abram and Rheobase study (`outputs/2026-09-07-vox-visual-study/`) and the first minute of two Cleo episodes:

- **The payoff comes first.** Second one shows the most exciting thing we have, big and moving. Cleo opens with the bone in her hand and the saber igniting.
- **The opening promises the film.** In a hook or promise passage, show something new about every second, and only things the episode really delivers.
- **Keep the state changing.** In an explaining passage, the subject changes state every 1 to 2 seconds, and the composition changes at least every 4 to 6 seconds. Holding a scene is fine; holding a picture that doesn't change is not.
- **Big subjects.** The thing the narration names fills at least a third of the frame on its words. No specks.
- **A fixed reference on a journey.** Keep one thing fixed (a figure, a shaft, "you are here") while the world changes around it.
- **Color and finish.** Each scene gets its own background color, never twice in a row. Use clean flat fills, crisp ink and light grain, with no muddy streak textures or heavy vignette.
- **Stills first.** Before animating a minute, render style stills and judge them beside demo and reference frames.

## No on-screen text, ever

No labels, numbers, names, captions, titles, logos or cards inside the video. The picture and Owen's voice carry everything. If something seems to need a label, redesign the picture so it reads without one. Separate subtitle files (.srt) are fine, because they aren't part of the picture.

## Sound

- **Owen's narration leads.** Everything else sits clearly underneath it.
- **Sound effects, not music** (creator, November 8, 2026). By default an episode has no music, only code-made effects: wind, whooshes on moves, impacts, cracks, thunder, rain, fire, glass. They sit on what the picture does. Background music goes in only where a moment truly needs it, and only with the creator's say-so. No cartoon beeps.
- **Recorded sounds are allowed as raw material** (creator, November 13, 2026: "yes use free licensed ones"). Only free sources whose licence allows a monetized channel: YouTube Audio Library, Sonniss GDC bundles, Freesound CC0 only, Pixabay as a last choice. Never CC-BY-NC. No paid libraries without an explicit yes. Log every clip (source, URL, licence, date) in the episode's `audio/sfx/sources.md`. Layer and process the clips so the result is ours. The creator can't record sounds yet, so don't plan around their recordings. Still no outside music.
- Target about -14 LUFS integrated for the final mix. The creator does the real listening check.
- **Sound rules from the November 13, 2026 study** (Jupiter's effects were about 39 dB under the voice, 94% of their energy was below 250 Hz, and one whoosh was repeated 239 times):
  - A continuous quiet bed under every scene sets the place. Spot effects go in the gaps between phrases (use `timing.json`), never on a key word.
  - Every effect has at least three layers (sharp start, body, tail) and at least three variations. Never the same sound twice in a row.
  - Everything gets space: near things are bright and dry, far things are dull with a long tail.
  - A hierarchy of weight: small points get no sound, the central moment gets the biggest. Use silence on purpose.
  - Effects must survive a phone speaker: after a 200 Hz high-pass they must still be clearly there. Measure this.
  - Measured levels: beds about 20 to 26 dB under the voice, spot effects 10 to 16 dB under, the few big moments up to voice level but only in pauses. The old flat "-10 dB" setting is retired.
  - The creator hears a 20 to 30 second sound test before anything long is rendered.

## Thumbnails

Thumbnails don't need brand colors. They just need to be good.
- Render them from the episode's own scene code at full resolution, so they match the video and stay original.
- One clear, striking image with no more than three main elements. It should be readable at phone size.
- Text is allowed on thumbnails, up to about three words, only if it adds something the image can't say. Typeset it in code; never use AI-generated lettering.
- Make 2 or 3 options and let the creator choose.
- **Eye-catching first** (creator, November 9, 2026, after studying Kurzgesagt: `outputs/2026-11-09-kurzgesagt-thumbnail-study/study.md`). One huge edge-to-edge headline of one to three words that creates tension, one luminous hyper-saturated subject on near-black, and one small scale cue such as a tiny label with a red arrow. Learn the qualities; never copy their art, layouts or wording.

## Technical

- Video: 1920x1080, 16:9, 30 fps (24 is acceptable), H.264 MP4, AAC audio.
- Each scene's source is plain JavaScript drawing on a canvas, driven by a time value so every frame can be rendered exactly. See `workflows/build.md`.

## The premium look (November 7, 2026, after the creator called v3b "a cheap copy")
Measured against Cleo, Vox and the zoom demo by ten specialists (`outputs/2026-11-07-premium-look/`). The code lives in `engine/look/`.
- **Light everything.** Key light from the upper left, a hard terminator, shadows tinted (lilac or a deep version of the object's own hue, never grey), a cool rim on the lower-right edges, contact shadows, and real glow and bloom on anything emissive.
- **Values and targeted color.**
  - Grounds are dark and fairly calm.
  - Subjects sit in saturated midtones; there are no pale cream stickers.
  - One hot accent per shot covers about 1 to 3% of the frame and goes on what the narration names.
  - Nothing big is paper white: the suit is tinted, and pure white is only for speculars and emissive cores.
  - Each shot's background hue differs from the last.
- **A line hierarchy, not one outline.**
  - Silhouette weight is set by on-screen size, heavier on the shadow side and lost on the lit side.
  - Inner lines are thin and colored.
  - Hatching appears only in shadow.
  - Glows, gas and far clouds get no ink.
- **Texture inside surfaces and a real finish.** True blacks; emissive cores allowed to blow out; visible fine grain stepping with the drawings; a vignette that deepens instead of greying.
- **Motion.**
  - Moves peak early and land softly, never with inOutCubic.
  - Arrivals overshoot 10 to 17% and keep drifting.
  - Reveals take about 25 frames.
  - Flashes last about 6 frames.
  - Parallax is real (sky 0.1, far 0.35, mid 0.7, foreground 1.4).
