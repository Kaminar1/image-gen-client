---
description: "Generate an AI image prompt for a game asset. Maintains consistent dark eldritch pixel art style across all assets."
---

# Generate Art Prompt

Generate a ready-to-paste AI image generation prompt for a game asset.

## Style Guide — Dark Eldritch

```
STYLE_ANCHOR:     "high-resolution pixel art, 64x64 base resolution, clean crisp edges, detailed pixel work"
COLOR_PALETTE:    "deep purple (#2D1B4E), midnight blue (#0D1B2A), antique gold (#C9A84C), bone white (#E8DCC8), blood crimson (#8B0000), shadow black (#0A0A0A)"
MOOD:             "dark eldritch fantasy, ominous, cosmic horror, divine malevolence"
INFLUENCES:       "Dead Cells pixel detail, Darkest Dungeon atmosphere, Cult of the Lamb dark whimsy, Loop Hero iconography"
RENDERING:        "crisp pixel art, no anti-aliasing on hard edges, subtle dithering for shadows, limited color count per sprite, pixel-perfect lines"
BACKGROUND:       "transparent background (PNG)" 
NEGATIVE_PROMPT:  "blurry, 3D render, photorealistic, smooth gradients, watermark, text, anti-aliased edges, soft brush strokes, anime style, chibi, cute"
```

## Theme Reference

- **Setting**: A dying world being consumed by an evil god's servant
- **Player**: Death's agent — starts as a lone reaper, grows into a commander of an undead workforce
- **Enemies**: Innocent villagers, town guards, knights, kings — the "good guys" are your targets
- **Resources**: Souls (purple glow), bone (white/cream), flesh (crimson), dark essence (deep purple particles)
- **Architecture**: Villages with thatched roofs → stone towns → castle cities — all progressively being corrupted/destroyed
- **God aesthetic**: Eldritch eye motifs, tentacles in the void, cosmic purple energy, gold divine symbols

## Instructions

1. Ask the user what asset they need (character, icon, environment, UI, etc.)
2. Ask for specifics (what character? what icon represents? what scene?)
3. Generate the prompt using the art-prompt-generation skill templates, filled in with Dark Eldritch style guide
4. Output the prompt in a code block, ready to copy-paste
5. If the AI tool is known, adapt the format (see art-prompt-generation skill for tool-specific formatting)
6. Log the prompt to `plans/dark-eldritch/art-prompts.md` if the user likes the result

## Example Output

If the user asks for "a villager enemy sprite":

```
High-resolution pixel art, 64x64 base resolution, clean crisp edges, detailed pixel work.
Character sprite of a terrified medieval villager clutching a pitchfork, mid-stride running pose,
wearing tattered brown tunic and leather boots. Facing right. 
Crisp pixel art, no anti-aliasing on hard edges, subtle dithering for shadows.
Color palette: deep purple shadows, midnight blue outlines, bone white skin highlights, 
blood crimson accents on wounds. Dark eldritch fantasy mood, ominous atmosphere.
Transparent background. Full body visible, centered in frame.
Style reference: Dead Cells character detail level, Darkest Dungeon color grading.
Negative: blurry, 3D render, photorealistic, smooth gradients, anti-aliased edges, anime style.
```

If the user asks for "a soul resource icon":

```
High-resolution pixel art, 32x32, clean crisp edges, detailed pixel work.
Game icon of a hovering spectral soul orb, wispy purple energy trails, faint golden core glow,
ethereal and unstable appearance. 
Crisp pixel art, no anti-aliasing, subtle dithering for the glow effect.
Color palette: deep purple (#2D1B4E) dominant, antique gold (#C9A84C) core, 
midnight blue (#0D1B2A) shadow, bone white (#E8DCC8) highlights.
Centered, clear silhouette, readable at small sizes. Transparent background.
Style reference: Loop Hero item icons, Dead Cells pickup items.
Negative: blurry, 3D render, photorealistic, smooth gradients, watermark, text.
```
