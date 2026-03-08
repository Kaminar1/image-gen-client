#!/usr/bin/env node

import { resolve, join, dirname } from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
import { config as loadEnv } from "dotenv";
import { parsePromptsFile } from "./parser.js";
import { createProvider, listProviders } from "./providers/index.js";
import type { RunOptions, ParsedPrompt } from "./types.js";
import { fileURLToPath } from "node:url";

// ── Load .env from the tool directory ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolRoot = resolve(__dirname, "..");
loadEnv({ path: join(toolRoot, ".env") });

// ── Minimal arg parser (no external deps) ──

function printUsage(): void {
    console.log(`
image-gen — Generate images from art-prompts.md using AI providers

USAGE
  npx tsx src/index.ts [options] <input-file>

OPTIONS
  --provider <name>     Provider to use (default: gemini)
                        Available: ${listProviders().join(", ")}
  --output <dir>        Output directory (default: assets/<project>/)
  --ids <id,id,...>     Only generate these asset IDs
  --categories <c,...>  Only generate assets in these categories
  --force               Overwrite existing files
  --dry-run             Preview what would be generated (no API calls)
  --delay <ms>          Delay between API calls (default: 1000)
  --samples <n>         Images per prompt (default: 1)
  --list                List all prompts found in the file and exit
  --help                Show this help

EXAMPLES
  # Dry run to see what's in the file
  npx tsx src/index.ts --dry-run plans/eradicate/art-prompts.md

  # Generate all character sprites
  npx tsx src/index.ts --categories "Characters" plans/eradicate/art-prompts.md

  # Generate specific assets
  npx tsx src/index.ts --ids CHR-01,CHR-02,ICN-05 plans/eradicate/art-prompts.md

  # Use a different provider
  npx tsx src/index.ts --provider stability plans/eradicate/art-prompts.md
`);
}

function parseArgs(argv: string[]): RunOptions {
    const args = argv.slice(2);
    const opts: RunOptions = {
        inputFile: "",
        outputDir: "",
        provider: "gemini",
        ids: [],
        categories: [],
        force: false,
        dryRun: false,
        delayMs: 1000,
        sampleCount: 1,
    };

    let listMode = false;
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        switch (arg) {
            case "--help":
            case "-h":
                printUsage();
                process.exit(0);
            case "--provider":
                opts.provider = args[++i];
                break;
            case "--output":
                opts.outputDir = args[++i];
                break;
            case "--ids":
                opts.ids = args[++i].split(",").map((s) => s.trim().toUpperCase());
                break;
            case "--categories":
                opts.categories = args[++i].split(",").map((s) => s.trim());
                break;
            case "--force":
                opts.force = true;
                break;
            case "--dry-run":
                opts.dryRun = true;
                break;
            case "--delay":
                opts.delayMs = parseInt(args[++i], 10);
                break;
            case "--samples":
                opts.sampleCount = parseInt(args[++i], 10);
                break;
            case "--list":
                listMode = true;
                break;
            default:
                if (arg.startsWith("-")) {
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
                }
                opts.inputFile = arg;
        }
        i++;
    }

    if (!opts.inputFile) {
        console.error("Error: No input file specified.\n");
        printUsage();
        process.exit(1);
    }

    // @ts-expect-error - Smuggle list mode through
    opts._listMode = listMode;

    return opts;
}

// ── Helpers ──

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Infer a project name from the input file path.
 * e.g. "plans/eradicate/art-prompts.md" → "eradicate"
 */
function inferProject(inputFile: string): string {
    const parts = resolve(inputFile).split(/[\\/]/);
    const plansIdx = parts.findIndex(
        (p) => p.toLowerCase() === "plans"
    );
    if (plansIdx >= 0 && plansIdx + 1 < parts.length) {
        return parts[plansIdx + 1];
    }
    return "output";
}

// ── Main ──

async function main(): Promise<void> {
    const opts = parseArgs(process.argv);
    const inputPath = resolve(opts.inputFile);

    console.log(`\n🎨 image-gen — AI art automation\n`);
    console.log(`  Input:    ${inputPath}`);

    // ── Parse prompts ──
    const allPrompts = await parsePromptsFile(inputPath);
    console.log(`  Found:    ${allPrompts.length} prompts`);

    if (allPrompts.length === 0) {
        console.log("\n  No prompts found in the file. Check the markdown format.");
        process.exit(1);
    }

    // ── List mode ──
    // @ts-expect-error - Smuggled list mode
    if (opts._listMode) {
        console.log("\n  ID              Category              Size      Name");
        console.log("  " + "─".repeat(72));
        for (const p of allPrompts) {
            const id = p.id.padEnd(14);
            const cat = p.category.padEnd(20);
            const size = `${p.width}x${p.height}`.padEnd(8);
            console.log(`  ${id}  ${cat}  ${size}  ${p.name}`);
        }
        console.log(`\n  Total: ${allPrompts.length} prompts`);
        process.exit(0);
    }

    // ── Filter prompts ──
    let prompts = allPrompts;

    if (opts.ids.length > 0) {
        prompts = prompts.filter((p) => opts.ids.includes(p.id.toUpperCase()));
        console.log(`  Filter:   IDs → ${prompts.length} matched`);
    }

    if (opts.categories.length > 0) {
        const cats = opts.categories.map((c) => c.toLowerCase());
        prompts = prompts.filter((p) =>
            cats.some((c) => p.category.toLowerCase().includes(c))
        );
        console.log(`  Filter:   Categories → ${prompts.length} matched`);
    }

    if (prompts.length === 0) {
        console.log("\n  No prompts matched the filters.");
        process.exit(0);
    }

    // ── Resolve output directory ──
    const project = inferProject(inputPath);
    const outputDir = opts.outputDir
        ? resolve(opts.outputDir)
        : resolve("assets", project);

    console.log(`  Output:   ${outputDir}`);
    console.log(`  Provider: ${opts.provider}`);

    if (opts.dryRun) {
        console.log(`  Mode:     DRY RUN (no API calls)\n`);
        printDryRun(prompts, outputDir, opts.force);
        return;
    }

    // ── Initialize provider ──
    console.log(`\n  Initializing ${opts.provider} provider...`);
    const provider = createProvider(opts.provider);
    await provider.init();

    // ── Ensure output directory exists ──
    await mkdir(outputDir, { recursive: true });

    // ── Generate images ──
    console.log(`\n  Generating ${prompts.length} images...\n`);

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        const outPath = join(outputDir, `${prompt.id}.png`);
        const progress = `[${i + 1}/${prompts.length}]`;

        // Skip existing unless --force
        if (!opts.force && (await fileExists(outPath))) {
            console.log(`  ${progress} SKIP  ${prompt.id} — already exists`);
            skipped++;
            continue;
        }

        try {
            console.log(
                `  ${progress} GEN   ${prompt.id} (${prompt.width}x${prompt.height}) — ${prompt.name}`
            );

            const result = await provider.generate(prompt, {
                sampleCount: opts.sampleCount,
            });

            await writeFile(outPath, result.data);
            console.log(
                `          ✓ Saved ${outPath} (${(result.data.length / 1024).toFixed(1)} KB)`
            );
            generated++;

            // Rate limit delay (skip after last)
            if (i < prompts.length - 1 && opts.delayMs > 0) {
                await sleep(opts.delayMs);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`          ✗ FAILED: ${msg}`);
            failed++;
        }
    }

    // ── Summary ──
    console.log(`\n  ─── Summary ───`);
    console.log(`  Generated: ${generated}`);
    console.log(`  Skipped:   ${skipped}`);
    console.log(`  Failed:    ${failed}`);
    console.log(`  Output:    ${outputDir}\n`);
}

function printDryRun(
    prompts: ParsedPrompt[],
    outputDir: string,
    force: boolean
): void {
    console.log("  Would generate:\n");
    for (const p of prompts) {
        const outPath = join(outputDir, `${p.id}.png`);
        console.log(`    ${p.id.padEnd(12)} ${p.category.padEnd(20)} ${p.width}x${p.height}  → ${outPath}`);
        // Show first 80 chars of prompt
        const preview = p.prompt.substring(0, 100).replace(/\n/g, " ");
        console.log(`${"".padEnd(38)}  "${preview}..."`);
    }
    console.log(`\n  Total: ${prompts.length} images`);
    if (!force) {
        console.log("  Note: Existing files will be skipped (use --force to overwrite)");
    }
}

main().catch((err) => {
    console.error("\n  Fatal error:", err.message ?? err);
    process.exit(1);
});
