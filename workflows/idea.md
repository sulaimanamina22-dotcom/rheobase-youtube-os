# Idea: find a topic worth 10+ minutes

## Viral first

The creator's rule (November 5, 2026): **we need viral ideas, not ideas we think are cool.** Demand comes first. A topic only gets pitched if there's evidence that lots of people want to click on it.

What counts as demand evidence (each pitch needs at least two kinds):
- **Outliers:** videos on this topic or question that got far more views than their channel's usual. Check Cleo Abram, Vsauce, Veritasium, Kurzgesagt, and smaller channels too. A small channel's breakout is the strongest signal, because it shows the topic itself pulled the views.
- **A curiosity people already have:** the question shows up in search suggestions, Reddit (r/askscience, r/explainlikeimfive, r/todayilearned), or "people also ask" boxes.
- **A current hook:** recent news, a viral post, or a trend that makes people want to understand this now. Keep it to things that will still be interesting in a year.
- **A thumbnail and title that would stop a scroll:** if you can't picture one in one breath, the idea isn't viral.

Things that make a topic spread: the viewer's body or everyday life, huge scale (the biggest, smallest, oldest, fastest), danger or mystery, "everything you knew is wrong", and the future. "Interesting to us" doesn't count.

Then, among topics with real demand, choose the one that fits Rheobase best.

## Where ideas come from, and the crowding check

Added November 13, 2026, after about 50 channels used our Jupiter title on the same day. Full study: `outputs/2026-11-13-idea-sourcing-study/study.md`.

- **Collect surprises before you need them.** Keep `memory/ideas.md`: every "wait, what?" found while reading, with its source. Cleo pitches only after weeks of reading about a subject; Stevens explores until a question emerges. Pitch from notes that have grown, not from trending templates.
- **Demand for the subject, uniqueness for the question.** The subject is huge and familiar (the Sun, the ocean, Earth, your body, everyday things). The exact question is one only we would ask. Shapes that work for them: "your picture of X is wrong", "an obvious thing about you, questioned", and limits ("how high can we build?").
- **Crowding check on every working title:** `python -I scripts/crowd.py "working title"`. More than about 5 same-key-word videos from small channels, or a farm template ("what if you fell into...", "where does X end", "what's inside X"), means rewrite the question. Put the result in the pitch.
- **Cleo's fill test:** a TLDR for a friend, what's huge if true, the key visual, and the visual list in order. If the visuals stall, drop the pitch.
- **Avoid** interviews, access stories, single products, policy and breaking news.

## What makes a Rheobase idea

An idea passes only if it's viral (above) and all five are true:

1. **A simple question with a deep answer.** Something a curious person could ask in one breath ("Why is the sky dark at night?"), where following the answer leads somewhere surprising and big.
2. **A chain of connected ideas.** At least 5 or 6 steps where each answer opens the next question. The chain is the episode.
3. **The chain can be shown as a zoom journey.** The steps connect visually too, through scale, shape or motion, so the episode can flow as one connected picture. Sketch the scene chain roughly at this stage.
4. **It matters.** It explains how something works and points to why it could matter for the future, with optimism that survives the strongest skeptic.
5. **It's ours.** It isn't a remake of a Cleo, Vsauce or other creator's episode. If they've covered it, we need a clearly new angle, new evidence or a better explanation.

Also check that reliable sources exist and that the visuals can be drawn honestly, without on-screen text.

## The pitch

When the creator asks for ideas, give 3 to 5 pitches. Each one is short:
- The question, in one line.
- The chain: 5 to 8 steps from the question to the payoff.
- The zoom journey: how the scenes connect (for example, "seed spiral, flock, galaxy").
- Why it matters, in one or two sentences.
- **Demand evidence:** the outlier videos (with views and channel size), searches or trends that prove people want this.
- **Crowding:** the `crowd.py` result for the working title (same-title videos, channels, median views).
- A working title and a thumbnail idea.
- Any honest risk: thin sources, too similar to an existing video, a hard-to-draw step.

Recommend one. **The creator picks.** Then create `episodes/YYYY-MM-DD-slug/` with `pitch.md` and `state.md`, and add the episode to `memory/videos.md`.
