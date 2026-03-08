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

# Force overwrite existing
npx tsx src/index.ts --force --ids CHR-01 ../../plans/eradicate/art-prompts.md
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

**Note:** Gemini models can't produce transparent PNGs. The provider automatically replaces "transparent background" in prompts with a chroma-key green (#00FF00) background for easy removal in post-processing.

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
  parser.ts          Markdown → ParsedPrompt[] parser
  types.ts           Shared interfaces
  providers/
    index.ts         Provider registry
    gemini.ts        Google Gemini / Imagen 3
```
