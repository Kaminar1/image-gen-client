# image-gen — Automated AI Art from Prompts

Reads `art-prompts.md` files and generates images via pluggable AI providers. Saves output using the asset ID naming convention (`CHR-01.png`, `ICN-05.png`, etc.).

## Quick Start

```bash
cd tools/image-gen
npm install

# Copy and fill in your API key
cp .env.example .env
# Edit .env → set GEMINI_API_KEY

# Preview what would be generated (no API calls)
npx tsx src/index.ts --dry-run ../../plans/eradicate/art-prompts.md

# List all prompts in the file
npx tsx src/index.ts --list ../../plans/eradicate/art-prompts.md

# Generate all images
npx tsx src/index.ts ../../plans/eradicate/art-prompts.md

# Generate specific assets
npx tsx src/index.ts --ids CHR-01,CHR-02,ICN-05 ../../plans/eradicate/art-prompts.md

# Generate by category
npx tsx src/index.ts --categories "Characters,Boss" ../../plans/eradicate/art-prompts.md

# Generate with automatic green-screen removal
npx tsx src/index.ts --remove-bg ../../plans/eradicate/art-prompts.md

# Remove green background from already-generated images
npx tsx src/strip-bg.ts assets/eradicate/

# Remove green BG but keep originals (saves alongside as _clean.png)
npx tsx src/strip-bg.ts --suffix _clean assets/eradicate/
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--provider <name>` | `gemini` | Image generation provider |
| `--output <dir>` | `assets/<project>/` | Output directory |
| `--ids <id,id,...>` | all | Generate only these asset IDs |
| `--categories <c,...>` | all | Generate only these categories |
| `--force` | `false` | Overwrite existing files |
| `--dry-run` | `false` | Preview without API calls |
| `--delay <ms>` | `1000` | Delay between API calls |
| `--samples <n>` | `1` | Images per prompt |
| `--remove-bg` | `false` | Remove #00FF00 green background after generation |
| `--bg-tolerance <n>` | `60` | Chroma-key hard cutoff distance (0-441) |
| `--bg-soft-edge <n>` | `30` | Soft-edge blending band width |
| `--list` | — | List all prompts and exit |

## Providers

### Gemini (Google AI Studio)

Supports both **Gemini** and **Imagen** models via Google AI Studio.

1. Get an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Set `GEMINI_API_KEY` in `.env`
3. Run with `--provider gemini` (default)

The provider auto-detects the endpoint based on the model name:

| Model | Endpoint | Notes |
|---|---|---|
| `gemini-2.0-flash-exp` (default) | `:generateContent` | Sends `responseModalities: ["IMAGE"]` + `imageConfig` with aspect ratio & size |
| `imagen-3.0-generate-002` | `:predict` | Uses `instances/parameters` format with `aspectRatio` + `outputOptions` |

Env vars:
- `GEMINI_API_KEY` — Required
- `GEMINI_MODEL` — Optional, defaults to `gemini-2.0-flash-exp`

**Note:** Gemini models can't produce transparent PNGs. The provider automatically replaces "transparent background" in prompts with a chroma-key green (#00FF00) background. Use `--remove-bg` during generation or `strip-bg` afterwards to convert green → transparent.

### PixelLab

Purpose-built **pixel art** generation via [pixellab.ai](https://pixellab.ai). Supports transparent backgrounds natively.

1. Create an account at [pixellab.ai](https://pixellab.ai)
2. Get your API token from [account settings](https://pixellab.ai/account)
3. Set `PIXELLAB_API_KEY` in `.env`
4. Run with `--provider pixellab`

| Model | Endpoint | Max Size | Notes |
|---|---|---|---|
| `pixflux` (default) | `/generate-image-pixflux` | 400×400 | General text-to-pixel-art |
| `bitforge` | `/generate-image-bitforge` | 200×200 | Style-guided, supports style images |

Env vars:
- `PIXELLAB_API_KEY` — Required
- `PIXELLAB_MODEL` — Optional, `pixflux` (default) or `bitforge`

Smart features:
- **Transparent backgrounds** — uses `no_background: true` natively (no green screen needed)
- **Direction extraction** — detects "Facing right" → `east`, "Facing left" → `west` from prompts
- **Detail level** — extracts detail hints from prompt text
- **Outline style** — detects outline preferences (lineless, black outline, etc.)
- **Prompt cleanup** — strips redundant pixel-art instructions (PixelLab already knows it's pixel art)
- **Auto-clamp** — scales oversized dimensions down while preserving aspect ratio

Additional endpoints available (not yet integrated, require reference images):
- `POST /animate-with-text` — text-driven animation frames (64×64)
- `POST /animate-with-skeleton` — skeleton-based animation
- `POST /rotate` — rotate characters/objects
- `POST /inpaint` — edit existing pixel art

## Green Background Removal (strip-bg)

Gemini generates with a green chroma-key (#00FF00) background since it can't produce transparency. Two ways to remove it:

### During generation

```bash
npx tsx src/index.ts --remove-bg ../../plans/eradicate/art-prompts.md
```

This generates images and immediately strips the green background in one pass.

### After generation (batch)

```bash
# Remove green BG from all PNGs in a folder (overwrites in-place)
npx tsx src/strip-bg.ts assets/eradicate/

# Preview what would be processed
npx tsx src/strip-bg.ts --dry-run assets/eradicate/

# Keep originals, save cleaned versions with a suffix
npx tsx src/strip-bg.ts --suffix _clean assets/eradicate/

# Process specific files with custom tolerance
npx tsx src/strip-bg.ts --tolerance 80 --soft-edge 20 assets/eradicate/CHR-01.png

# Remove a different colour (e.g. magenta)
npx tsx src/strip-bg.ts --colour "#FF00FF" assets/eradicate/
```

| Flag | Default | Description |
|---|---|---|
| `--colour <hex>` | `#00FF00` | Key colour to remove |
| `--tolerance <n>` | `60` | Hard cutoff distance in RGB space (0-441) |
| `--soft-edge <n>` | `30` | Soft-edge blending band for smooth edges |
| `--suffix <text>` | — | Save as `<name><suffix>.png` instead of overwriting |
| `--dry-run` | `false` | List files without processing |

**How it works:** For each pixel, it computes the Euclidean distance in RGB space from the key colour. Pixels within `tolerance` become fully transparent. Pixels between `tolerance` and `tolerance + soft-edge` get proportional alpha for smooth edges. Everything else stays as-is.

### Adding a New Provider

1. Create `src/providers/your-provider.ts` implementing `ImageProvider`:

```typescript
import type { ImageProvider, ParsedPrompt, GenerateOptions, GeneratedImage } from "../types.js";

export class YourProvider implements ImageProvider {
  readonly name = "your-provider";

  async init(): Promise<void> {
    // Validate API key, check connectivity
  }

  adaptPrompt(prompt: string, negative?: string): string {
    // Reformat prompt for this provider's format
    return prompt;
  }

  async generate(prompt: ParsedPrompt, options?: GenerateOptions): Promise<GeneratedImage> {
    // Call the API, return image bytes
    return { data: Buffer.from([]), mimeType: "image/png" };
  }
}
```

2. Register it in `src/providers/index.ts`:

```typescript
import { YourProvider } from "./your-provider.js";

const providerFactories: Record<string, () => ImageProvider> = {
  gemini: () => new GeminiProvider(),
  "your-provider": () => new YourProvider(),  // ← add here
};
```

3. Use it: `--provider your-provider`

## How It Parses art-prompts.md

The parser expects this markdown structure:

```markdown
## Category Name — 64x64 transparent PNG

### ASSET-ID — Asset Name
\```
Prompt text goes here...
\```
```

It extracts:
- **ID** from the `### ID — Name` header
- **Category** from the `## Category — Size` header
- **Dimensions** from the section header (or from the prompt text as fallback)
- **Prompt** from the code block

## Output Structure

```
assets/
  eradicate/
    CHR-01.png
    CHR-02.png
    ICN-01.png
    BG-01.png
    ...
```

## Architecture

```
src/
  index.ts           CLI entry point, arg parsing, orchestration
  strip-bg.ts        Standalone green-background removal CLI
  parser.ts          Markdown → ParsedPrompt[] parser
  types.ts           Shared interfaces
  providers/
    index.ts         Provider registry
    gemini.ts        Google Gemini / Imagen 3
    pixellab.ts      PixelLab (pixflux + bitforge)
  postprocess/
    chroma-key.ts    Green-screen removal (sharp-based)
```
