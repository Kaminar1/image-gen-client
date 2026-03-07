---
name: art-prompt-generation
description: "Generate consistent AI image prompts for game art assets. Use when creating sprites, icons, UI, environments, or any visual asset. Ensures style consistency across all generated art by enforcing a project-specific style guide."
---

# Art Prompt Generation Skill

Generate AI image generation prompts that produce visually consistent game art assets. This skill ensures every prompt follows the project's art direction so assets look like they belong together.

## Why This Exists

AI image generators produce wildly different results without careful prompt engineering. This skill locks down:
- **Style consistency**: Every asset uses the same art style descriptors
- **Color consistency**: Palette is enforced across all prompts
- **Format consistency**: Output specs (resolution, transparency, format) match engine requirements
- **Tone consistency**: Mood and theme stay coherent

## How To Use

1. **First**: Customize the Style Guide section below for your game (or use a game-specific prompt that extends this skill)
2. **Then**: When the user asks for an art asset, generate a prompt following the Prompt Template
3. **Always**: Include the style anchor, palette, and technical specs in every prompt

## Style Guide (Customize Per Project)

Fill these in for your game:

```
STYLE_ANCHOR:     [e.g., "high-res pixel art, 64x64, clean edges"]
COLOR_PALETTE:    [e.g., "deep purple, midnight blue, gold accents, bone white highlights"]
MOOD:             [e.g., "dark fantasy, eldritch, ominous"]
INFLUENCES:       [e.g., "Dead Cells, Darkest Dungeon, Cult of the Lamb"]
RENDERING:        [e.g., "crisp pixel art, no anti-aliasing on edges, subtle dithering for shading"]
BACKGROUND:       [e.g., "transparent PNG" or "solid black" depending on asset type]
NEGATIVE_PROMPT:  [e.g., "blurry, 3D render, photorealistic, smooth gradients, watermark"]
```

## Prompt Template

Every prompt should follow this structure:

```
[ASSET_TYPE] of [SUBJECT_DESCRIPTION].
[STYLE_ANCHOR]. [RENDERING].
Color palette: [COLOR_PALETTE].
Mood: [MOOD].
[TECHNICAL_SPECS].
[NEGATIVE_PROMPT if supported by tool].
```

### Asset-Specific Templates

#### Characters / Sprites
```
[STYLE_ANCHOR] character sprite of [CHARACTER_DESCRIPTION], [POSE/ACTION],
[EQUIPMENT/DETAILS]. Facing [DIRECTION]. [RENDERING].
Color palette: [COLOR_PALETTE]. Mood: [MOOD].
[BACKGROUND]. Full body visible, centered in frame.
```

#### Icons / Items
```
[STYLE_ANCHOR] icon of [ITEM_DESCRIPTION], [DETAILS].
[RENDERING]. Centered, clear silhouette, readable at small sizes.
Color palette: [COLOR_PALETTE]. [BACKGROUND].
```

#### UI Elements
```
[STYLE_ANCHOR] game UI [ELEMENT_TYPE]: [DESCRIPTION].
[RENDERING]. Clean edges, consistent border style.
Color palette: [COLOR_PALETTE]. [BACKGROUND].
```

#### Environment / Tiles
```
[STYLE_ANCHOR] [ENVIRONMENT_TYPE] environment, [DESCRIPTION], [LIGHTING].
[RENDERING]. Tileable where appropriate.
Color palette: [COLOR_PALETTE]. Mood: [MOOD].
```

#### Splash Art / Key Art
```
[STYLE_ANCHOR] key art for [GAME_TITLE]: [SCENE_DESCRIPTION].
[RENDERING]. Cinematic composition, [ASPECT_RATIO].
Color palette: [COLOR_PALETTE]. Mood: [MOOD].
Reference style: [INFLUENCES].
```

## Technical Specs by Asset Type

| Asset Type | Resolution | Format | Notes |
|---|---|---|---|
| Character sprite | 64x64 to 128x128 | PNG, transparent BG | Consistent canvas size per category |
| Icon | 32x32 to 64x64 | PNG, transparent BG | Must read at small size |
| UI frame/panel | Variable | PNG, transparent BG | 9-slice friendly if possible |
| Tile | 32x32 or 64x64 | PNG | Seamless edges for tileable |
| Background | 1920x1080+ | PNG/JPG | Can have solid BG |
| Key art | 1920x1080+ | PNG | Marketing/splash screens |

## Prompt Quality Checklist

Before outputting a prompt, verify:
- [ ] Style anchor is included (exact same wording every time)
- [ ] Color palette is specified (not left to AI's default)
- [ ] Mood/tone descriptor is present
- [ ] Technical specs (resolution, background, format) are stated
- [ ] Negative prompt excludes unwanted styles
- [ ] Subject description is specific (not vague like "a sword" — say "a jagged obsidian sacrificial dagger with glowing purple runes")
- [ ] Composition is specified (centered, full body, close-up, etc.)

## Multi-Tool Adaptation

Different AI tools need slightly different prompt formats:

### Midjourney
- Put style at the end with `--style` or `--s`
- Use `--ar` for aspect ratio, `--no` for negative prompt
- Keep prompts under ~200 words

### DALL-E / ChatGPT
- Be very descriptive and literal
- Specify "digital art" or "pixel art" explicitly
- No parameter flags — everything in natural language

### Stable Diffusion
- Use `negative_prompt:` separately
- Add model-specific trigger words if using fine-tuned models
- Use `(emphasis:1.2)` weighting syntax for key elements

### Grok Imagine
- Natural language, descriptive
- Specify style explicitly in the prompt
- Include reference to art style ("in the style of high-res pixel art game sprites")

## Consistency Rules

1. **Never change the style anchor mid-project** — use the exact same wording
2. **Generate related assets together** — a set of enemy sprites in one session stays more consistent
3. **Save your best results** and reference them: "in the same style as [previous asset]"
4. **Use seed values** when available (Stable Diffusion, Midjourney) to reproduce similar aesthetics
5. **Document every prompt** that produces a keeper — store in `plans/<project>/art-prompts.md`
