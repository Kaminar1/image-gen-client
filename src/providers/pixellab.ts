import type { ImageProvider, ParsedPrompt, GenerateOptions, GeneratedImage } from "../types.js";

/**
 * PixelLab provider — purpose-built pixel art generation.
 *
 * Endpoints:
 *   POST /generate-image-pixflux   — text-to-pixel-art (max 400×400)
 *   POST /generate-image-bitforge  — style-guided pixel art (max 200×200)
 *   POST /animate-with-text        — text-driven animation frames (64×64 only)
 *   POST /animate-with-skeleton    — skeleton-driven animation frames
 *   POST /rotate                   — rotate a character/object
 *   POST /inpaint                  — edit existing pixel art
 *
 * Set PIXELLAB_MODEL to choose the endpoint:
 *   "pixflux"  (default) — general text-to-pixel-art
 *   "bitforge"           — style-guided, smaller max size
 *
 * Auth: Bearer token from https://pixellab.ai/account
 * Docs: https://api.pixellab.ai/v1/docs
 */

type PixelLabModel = "pixflux" | "bitforge";

// ── Direction extraction ──

const DIRECTION_MAP: Array<{ pattern: RegExp; direction: string }> = [
    { pattern: /facing\s+right/i, direction: "east" },
    { pattern: /facing\s+left/i, direction: "west" },
    { pattern: /facing\s+up/i, direction: "north" },
    { pattern: /facing\s+down/i, direction: "south" },
    { pattern: /facing\s+forward/i, direction: "south" },
    { pattern: /facing\s+away/i, direction: "north" },
    { pattern: /facing\s+the\s+viewer/i, direction: "south" },
    // Side views
    { pattern: /side\s+view.*right/i, direction: "east" },
    { pattern: /side\s+view.*left/i, direction: "west" },
    { pattern: /viewed?\s+from\s+above/i, direction: "south" },
];

function extractDirection(prompt: string): string | undefined {
    for (const { pattern, direction } of DIRECTION_MAP) {
        if (pattern.test(prompt)) return direction;
    }
    return undefined;
}

// ── Detail extraction ──

function extractDetail(prompt: string): string | undefined {
    if (/highly\s+detailed|very\s+detailed|intricate\s+detail/i.test(prompt))
        return "highly detailed";
    if (/low\s+detail|simple|minimal/i.test(prompt)) return "low detail";
    // Default to medium for most art-prompts.md content
    return "medium detail";
}

// ── Outline extraction ──

function extractOutline(prompt: string): string | undefined {
    if (/no\s+outline|lineless/i.test(prompt)) return "lineless";
    if (/black\s+outline/i.test(prompt)) return "single color black outline";
    if (/selective\s+outline/i.test(prompt)) return "selective outline";
    // Don't set outline if not mentioned — let the model decide
    return undefined;
}

// ── Size clamping ──

interface SizeLimits {
    minSide: number;
    maxArea: number;
}

const MODEL_LIMITS: Record<PixelLabModel, SizeLimits> = {
    pixflux: { minSide: 32, maxArea: 400 * 400 },
    bitforge: { minSide: 16, maxArea: 200 * 200 },
};

/**
 * Clamp dimensions to the model's supported range while preserving aspect ratio.
 */
function clampDimensions(
    width: number,
    height: number,
    model: PixelLabModel
): { width: number; height: number } {
    const limits = MODEL_LIMITS[model];

    // Enforce minimums
    let w = Math.max(width, limits.minSide);
    let h = Math.max(height, limits.minSide);

    // If area exceeds max, scale down proportionally
    const area = w * h;
    if (area > limits.maxArea) {
        const scale = Math.sqrt(limits.maxArea / area);
        w = Math.floor(w * scale);
        h = Math.floor(h * scale);
    }

    return { width: w, height: h };
}

// ── Provider ──

export class PixelLabProvider implements ImageProvider {
    readonly name = "pixellab";

    private apiKey: string;
    private model: PixelLabModel;
    private baseUrl: string;

    constructor() {
        this.apiKey = process.env.PIXELLAB_API_KEY ?? "";
        const modelEnv = (process.env.PIXELLAB_MODEL ?? "pixflux").toLowerCase();
        if (modelEnv !== "pixflux" && modelEnv !== "bitforge") {
            throw new Error(
                `Invalid PIXELLAB_MODEL "${modelEnv}". Use "pixflux" or "bitforge".`
            );
        }
        this.model = modelEnv;
        this.baseUrl = "https://api.pixellab.ai/v1";
    }

    async init(): Promise<void> {
        if (!this.apiKey) {
            throw new Error(
                "PIXELLAB_API_KEY is not set. Get your token at https://pixellab.ai/account\n" +
                "Set it in tools/image-gen/.env or as an environment variable."
            );
        }
        // Validate key by checking balance
        const res = await fetch(`${this.baseUrl}/balance`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(
                `PixelLab API key validation failed (${res.status}): ${body}`
            );
        }
        const balance = (await res.json()) as { usd: number };
        console.log(
            `  ✓ PixelLab provider ready (model: ${this.model}, balance: $${balance.usd.toFixed(2)})`
        );
    }

    adaptPrompt(prompt: string, _negative?: string): string {
        // PixelLab is purpose-built for pixel art, so we strip pixel-art-specific
        // instructions that are redundant (the model already knows it's pixel art).
        let adapted = prompt;

        // Remove pixel art style instructions (PixelLab does this natively)
        adapted = adapted.replace(
            /high-res(olution)?\s+pixel\s+art,?\s*/gi,
            ""
        );
        adapted = adapted.replace(
            /crisp\s+pixel\s+art,?\s*no\s+anti-aliasing[^.]*\.?\s*/gi,
            ""
        );
        adapted = adapted.replace(
            /subtle\s+dithering[^.]*\.?\s*/gi,
            ""
        );
        adapted = adapted.replace(
            /limited\s+(color\s+)?palette\.?\s*/gi,
            ""
        );

        // Remove dimension specs (we pass exact dimensions via image_size)
        adapted = adapted.replace(/\d{2,4}x\d{2,4}\s*(?:pixels?|px)?,?\s*/gi, "");

        // Remove background instructions (we use no_background parameter)
        adapted = adapted.replace(
            /transparent\s+background\.?\s*/gi,
            ""
        );
        adapted = adapted.replace(
            /solid\s+bright\s+green[^.]*\.?\s*/gi,
            ""
        );

        // Remove negative prompt section (PixelLab doesn't need it — it's already pixel art)
        adapted = adapted.replace(
            /Negative:?\s*[^.]*\.?\s*/gi,
            ""
        );

        // Remove style reference lines (PixelLab has its own style system)
        adapted = adapted.replace(
            /Style\s+reference:?\s*[^.]*\.?\s*/gi,
            ""
        );

        // Clean up double spaces, leading/trailing commas
        adapted = adapted.replace(/,\s*,/g, ",");
        adapted = adapted.replace(/\.\s*\./g, ".");
        adapted = adapted.replace(/\s{2,}/g, " ");
        adapted = adapted.trim();
        adapted = adapted.replace(/^[,.\s]+/, "").replace(/[,\s]+$/, "");

        return adapted;
    }

    async generate(
        prompt: ParsedPrompt,
        _options?: GenerateOptions
    ): Promise<GeneratedImage> {
        const adaptedPrompt = this.adaptPrompt(prompt.prompt);
        const endpoint =
            this.model === "bitforge"
                ? "generate-image-bitforge"
                : "generate-image-pixflux";

        const url = `${this.baseUrl}/${endpoint}`;
        const { width, height } = clampDimensions(prompt.width, prompt.height, this.model);

        // Detect if the asset should have a transparent background
        const wantsTransparency =
            /transparent/i.test(prompt.formatHint) ||
            /transparent\s+background/i.test(prompt.prompt) ||
            /transparent\s+BG/i.test(prompt.prompt);

        // Build request body
        const body: Record<string, unknown> = {
            description: adaptedPrompt,
            image_size: { width, height },
            no_background: wantsTransparency,
        };

        // Extract optional hints from the prompt text
        const direction = extractDirection(prompt.prompt);
        if (direction) body.direction = direction;

        const detail = extractDetail(prompt.prompt);
        if (detail) body.detail = detail;

        const outline = extractOutline(prompt.prompt);
        if (outline) body.outline = outline;

        // Bitforge-specific defaults
        if (this.model === "bitforge") {
            body.text_guidance_scale = 3;
            body.style_guidance_scale = 3;
            body.style_strength = 20;
        }

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorBody = await res.text();
            throw new Error(
                `PixelLab ${this.model} generation failed for ${prompt.id} (${res.status}):\n${errorBody}`
            );
        }

        const data = (await res.json()) as {
            image: { type: string; base64: string };
            usage: { type: string; credits: number };
        };

        // Response base64 includes the data URI prefix "data:image/png;base64,..."
        const base64Data = data.image.base64.replace(
            /^data:image\/\w+;base64,/,
            ""
        );
        const imageBuffer = Buffer.from(base64Data, "base64");

        return {
            data: imageBuffer,
            mimeType: "image/png",
            metadata: {
                model: this.model,
                endpoint,
                requestedSize: `${prompt.width}x${prompt.height}`,
                actualSize: `${width}x${height}`,
                direction,
                detail,
                outline,
                noBackground: wantsTransparency,
                credits: data.usage.credits,
            },
        };
    }
}
