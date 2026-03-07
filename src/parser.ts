import { readFile } from "node:fs/promises";
import type { ParsedPrompt } from "./types.js";

// ── Section header pattern ──
// Matches: ## Characters — 64x64 transparent PNG
//          ## Backgrounds — 1280x720 PNG
const SECTION_RE =
    /^##\s+(.+?)\s*[—–-]\s*(?:(\d+)x(\d+))?\s*(.*?)$/;

// ── Prompt header pattern ──
// Matches: ### CHR-01 — Harbinger (idle)
//          ### BOSS-03 — High Priest (Town Boss)
const PROMPT_RE =
    /^###\s+([\w-]+)\s*[—–-]\s*(.+?)$/;

// ── Code block fences ──
const FENCE_OPEN = /^```/;
const FENCE_CLOSE = /^```$/;

/**
 * Compute the closest standard aspect ratio for a given width × height.
 * Providers typically support: 1:1, 3:4, 4:3, 9:16, 16:9
 */
function computeAspectRatio(w: number, h: number): string {
    const ratio = w / h;
    const supported = [
        { label: "1:1", value: 1 },
        { label: "3:4", value: 3 / 4 },
        { label: "4:3", value: 4 / 3 },
        { label: "9:16", value: 9 / 16 },
        { label: "16:9", value: 16 / 9 },
    ];
    let closest = supported[0];
    let minDiff = Infinity;
    for (const s of supported) {
        const diff = Math.abs(ratio - s.value);
        if (diff < minDiff) {
            minDiff = diff;
            closest = s;
        }
    }
    return closest.label;
}

/**
 * Try to extract dimensions from the prompt text itself (fallback).
 * Looks for patterns like "64x64 pixels" or "1280x720 pixels" or "32x32".
 */
function extractDimensionsFromPrompt(prompt: string): [number, number] | null {
    const match = prompt.match(/(\d{2,4})x(\d{2,4})\s*(?:pixels?|px)?/i);
    if (match) {
        return [parseInt(match[1], 10), parseInt(match[2], 10)];
    }
    return null;
}

/**
 * Parse an art-prompts.md file into structured prompt objects.
 */
export async function parsePromptsFile(
    filePath: string
): Promise<ParsedPrompt[]> {
    const content = await readFile(filePath, "utf-8");
    return parsePrompts(content);
}

/**
 * Parse raw markdown content into structured prompt objects.
 */
export function parsePrompts(content: string): ParsedPrompt[] {
    const lines = content.split(/\r?\n/);
    const prompts: ParsedPrompt[] = [];

    let currentCategory = "";
    let sectionWidth = 0;
    let sectionHeight = 0;
    let sectionFormat = "";

    let pendingId = "";
    let pendingName = "";
    let inCodeBlock = false;
    let codeLines: string[] = [];

    for (const line of lines) {
        // ── Section header ──
        const sectionMatch = line.match(SECTION_RE);
        if (sectionMatch && !inCodeBlock) {
            currentCategory = sectionMatch[1].trim();
            sectionWidth = sectionMatch[2] ? parseInt(sectionMatch[2], 10) : 0;
            sectionHeight = sectionMatch[3] ? parseInt(sectionMatch[3], 10) : 0;
            sectionFormat = sectionMatch[4]?.trim() ?? "";
            continue;
        }

        // ── Prompt header ──
        const promptMatch = line.match(PROMPT_RE);
        if (promptMatch && !inCodeBlock) {
            pendingId = promptMatch[1].trim();
            pendingName = promptMatch[2].trim();
            continue;
        }

        // ── Code block boundaries ──
        if (FENCE_OPEN.test(line) && !inCodeBlock) {
            inCodeBlock = true;
            codeLines = [];
            continue;
        }

        if (FENCE_CLOSE.test(line) && inCodeBlock) {
            inCodeBlock = false;

            // Only emit if we have a pending ID (skip style guide blocks, etc.)
            if (pendingId && codeLines.length > 0) {
                const promptText = codeLines.join("\n").trim();

                // Resolve dimensions: section header > prompt text > default
                let w = sectionWidth;
                let h = sectionHeight;
                if (!w || !h) {
                    const fromPrompt = extractDimensionsFromPrompt(promptText);
                    if (fromPrompt) {
                        [w, h] = fromPrompt;
                    } else {
                        w = w || 64;
                        h = h || 64;
                    }
                }

                prompts.push({
                    id: pendingId,
                    name: pendingName,
                    category: currentCategory,
                    width: w,
                    height: h,
                    prompt: promptText,
                    aspectRatio: computeAspectRatio(w, h),
                    formatHint: sectionFormat,
                });

                pendingId = "";
                pendingName = "";
            }
            continue;
        }

        // ── Inside code block: collect lines ──
        if (inCodeBlock) {
            codeLines.push(line);
        }
    }

    return prompts;
}
