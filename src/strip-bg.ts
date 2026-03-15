#!/usr/bin/env node

/**
 * strip-bg — Remove chroma-key green (#00FF00) backgrounds from PNG images.
 *
 * Standalone command for batch-processing already-generated images.
 *
 * USAGE
 *   npx tsx src/strip-bg.ts [options] <path...>
 *
 * Paths can be individual .png files or directories (all PNGs inside will
 * be processed).
 *
 * OPTIONS
 *   --colour <hex>       Key colour to remove (default: "#00FF00")
 *   --tolerance <n>      Hard cutoff distance in RGB space (default: 60)
 *   --soft-edge <n>      Soft-edge band beyond tolerance (default: 30)
 *   --suffix <text>      Save as <name><suffix>.png instead of overwriting
 *   --dry-run            List files that would be processed
 *   --help               Show this help
 *
 * EXAMPLES
 *   # Remove green from all PNGs in a folder (in-place)
 *   npx tsx src/strip-bg.ts assets/eradicate/
 *
 *   # Preview what would be processed
 *   npx tsx src/strip-bg.ts --dry-run assets/eradicate/
 *
 *   # Save cleaned files alongside originals (e.g. CHR-01_clean.png)
 *   npx tsx src/strip-bg.ts --suffix _clean assets/eradicate/
 *
 *   # Process specific files with custom tolerance
 *   npx tsx src/strip-bg.ts --tolerance 80 assets/eradicate/CHR-01.png assets/eradicate/BOSS-01.png
 */

import { resolve, join, extname, basename, dirname } from "node:path";
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { removeChromaKey, type ChromaKeyOptions } from "./postprocess/chroma-key.js";

// ── Arg parsing ──

interface StripBgOptions {
    paths: string[];
    colour: string;
    tolerance: number;
    softEdge: number;
    minIslandSize: number;
    suffix: string;
    dryRun: boolean;
}

function printUsage(): void {
    console.log(`
strip-bg — Remove chroma-key green background from PNGs

USAGE
  npx tsx src/strip-bg.ts [options] <path...>

OPTIONS
  --colour <hex>       Key colour to remove (default: "#00FF00")
  --tolerance <n>      Hard cutoff distance, 0-441 (default: 60)
  --soft-edge <n>      Soft-edge blending band (default: 30)
  --min-island <n>     Min pixels for enclosed green to count as BG (default: 16)
  --suffix <text>      Save as <name><suffix>.png instead of overwriting
  --dry-run            List files that would be processed
  --help               Show this help

EXAMPLES
  npx tsx src/strip-bg.ts assets/eradicate/
  npx tsx src/strip-bg.ts --suffix _clean assets/eradicate/
  npx tsx src/strip-bg.ts --tolerance 80 --soft-edge 20 CHR-01.png BOSS-01.png
`);
}

function parseArgs(argv: string[]): StripBgOptions {
    const args = argv.slice(2);
    const opts: StripBgOptions = {
        paths: [],
        colour: "#00FF00",
        tolerance: 60,
        softEdge: 30,
        minIslandSize: 16,
        suffix: "",
        dryRun: false,
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        switch (arg) {
            case "--help":
            case "-h":
                printUsage();
                process.exit(0);
            case "--colour":
            case "--color":
                opts.colour = args[++i];
                break;
            case "--tolerance":
                opts.tolerance = parseInt(args[++i], 10);
                break;
            case "--soft-edge":
                opts.softEdge = parseInt(args[++i], 10);
                break;
            case "--min-island":
                opts.minIslandSize = parseInt(args[++i], 10);
                break;
            case "--suffix":
                opts.suffix = args[++i];
                break;
            case "--dry-run":
                opts.dryRun = true;
                break;
            default:
                if (arg.startsWith("-")) {
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
                }
                opts.paths.push(arg);
        }
        i++;
    }

    if (opts.paths.length === 0) {
        console.error("Error: No files or directories specified.\n");
        printUsage();
        process.exit(1);
    }

    return opts;
}

// ── Collect PNG files from paths ──

async function collectPngs(paths: string[]): Promise<string[]> {
    const files: string[] = [];

    for (const p of paths) {
        const resolved = resolve(p);
        const info = await stat(resolved);

        if (info.isDirectory()) {
            const entries = await readdir(resolved);
            for (const entry of entries) {
                if (extname(entry).toLowerCase() === ".png") {
                    files.push(join(resolved, entry));
                }
            }
        } else if (extname(resolved).toLowerCase() === ".png") {
            files.push(resolved);
        } else {
            console.warn(`  ⚠ Skipping non-PNG file: ${resolved}`);
        }
    }

    return files;
}

// ── Compute output path ──

function outputPath(inputPath: string, suffix: string): string {
    if (!suffix) return inputPath; // overwrite in-place
    const dir = dirname(inputPath);
    const name = basename(inputPath, ".png");
    return join(dir, `${name}${suffix}.png`);
}

// ── Main ──

async function main(): Promise<void> {
    const opts = parseArgs(process.argv);

    console.log(`\n🎨 strip-bg — Chroma-key background removal\n`);
    console.log(`  Key colour:  ${opts.colour}`);
    console.log(`  Tolerance:   ${opts.tolerance}`);
    console.log(`  Soft edge:   ${opts.softEdge}`);
    console.log(`  Min island:  ${opts.minIslandSize}px`);
    if (opts.suffix) console.log(`  Suffix:      ${opts.suffix}`);

    const files = await collectPngs(opts.paths);
    console.log(`  Files found: ${files.length}\n`);

    if (files.length === 0) {
        console.log("  No PNG files found at the specified paths.");
        process.exit(0);
    }

    if (opts.dryRun) {
        console.log("  DRY RUN — would process:\n");
        for (const f of files) {
            const out = outputPath(f, opts.suffix);
            const label = out === f ? "(in-place)" : `→ ${out}`;
            console.log(`    ${basename(f)}  ${label}`);
        }
        console.log(`\n  Total: ${files.length} files`);
        return;
    }

    const chromaOpts: ChromaKeyOptions = {
        keyColour: opts.colour,
        tolerance: opts.tolerance,
        softEdge: opts.softEdge,
        minIslandSize: opts.minIslandSize,
    };

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const out = outputPath(file, opts.suffix);
        const progress = `[${i + 1}/${files.length}]`;

        try {
            const input = await readFile(file);
            const result = await removeChromaKey(input, chromaOpts);
            await writeFile(out, result);

            const savedKb = ((input.length - result.length) / 1024).toFixed(1);
            const label = out === file ? "(in-place)" : `→ ${basename(out)}`;
            console.log(
                `  ${progress} ✓ ${basename(file)} ${label}  ` +
                `(${(result.length / 1024).toFixed(1)} KB, saved ${savedKb} KB)`
            );
            processed++;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ${progress} ✗ ${basename(file)} — ${msg}`);
            failed++;
        }
    }

    console.log(`\n  ─── Summary ───`);
    console.log(`  Processed: ${processed}`);
    console.log(`  Failed:    ${failed}`);
    if (opts.suffix) {
        console.log(`  Output:    *${opts.suffix}.png files alongside originals`);
    } else {
        console.log(`  Output:    Overwritten in-place`);
    }
    console.log();
}

main().catch((err) => {
    console.error("\n  Fatal error:", err.message ?? err);
    process.exit(1);
});
