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
npx tsx src/index.ts --dry-run ../../plans/projectname/art-prompts.md

# List all prompts in the file
npx tsx src/index.ts --list ../../plans/projectname/art-prompts.md

# Generate all images
npx tsx src/index.ts ../../plans/projectname/art-prompts.md

# Generate specific assets
npx tsx src/index.ts --ids CHR-01,CHR-02,ICN-05 ../../plans/projectname/art-prompts.md

# Generate by category
npx tsx src/index.ts --categories "Characters,Boss" ../../plans/projectname/art-prompts.md

# Force overwrite existing
npx tsx src/index.ts --force --ids CHR-01 ../../plans/projectname/art-prompts.md
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

Uses **Imagen 3** via the Generative Language API.

1. Get an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Set `GEMINI_API_KEY` in `.env`
3. Run with `--provider gemini` (default)

Env vars:
- `GEMINI_API_KEY` — Required
- `GEMINI_MODEL` — Optional, defaults to `imagen-3.0-generate-002`

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
  projectname/
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
