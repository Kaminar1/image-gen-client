import type { ImageProvider, ParsedPrompt, GenerateOptions, GeneratedImage } from "../types.js";

/**
 * Google Gemini image generation provider.
 *
 * Supports two API styles depending on the model:
 *
 *   Gemini models (gemini-2.0-flash-exp, etc.)
 *     → POST :generateContent  with responseModalities: ["IMAGE"]
 *
 *   Imagen models (imagen-3.0-generate-002, etc.)
 *     → POST :predict  with instances/parameters format
 *
 * Set GEMINI_MODEL in .env to switch between them.
 * Requires a GEMINI_API_KEY from https://aistudio.google.com/apikey
 */

// ── Endpoint detection ──

type EndpointStyle = "generateContent" | "predict";

function detectEndpoint(model: string): EndpointStyle {
    // Imagen models use the :predict endpoint
    if (model.startsWith("imagen")) {
        return "predict";
    }
    // Everything else (gemini-*) uses :generateContent
    return "generateContent";
}

// ── Image size mapping ──

/**
 * Map pixel dimensions to the closest imageSize value supported by the API.
 * Known values: "256", "512", "1024", "2K"
 */
function mapImageSize(width: number, height: number): string | undefined {
    const maxDim = Math.max(width, height);
    if (maxDim <= 256) return "256";
    if (maxDim <= 512) return "512";
    if (maxDim <= 1024) return "1024";
    return "2K";
}

// ── Provider ──

export class GeminiProvider implements ImageProvider {
    readonly name = "gemini";

    private apiKey: string;
    private model: string;
    private baseUrl: string;
    private endpoint: EndpointStyle;

    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY ?? "";
        this.model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash-exp";
        this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
        this.endpoint = detectEndpoint(this.model);
    }

    async init(): Promise<void> {
        if (!this.apiKey) {
            throw new Error(
                "GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey\n" +
                "Set it in tools/image-gen/.env or as an environment variable."
            );
        }
        // Quick validation: verify the model exists with this key
        const url = `${this.baseUrl}/models/${this.model}?key=${this.apiKey}`;
        const res = await fetch(url);
        if (!res.ok) {
            const body = await res.text();
            throw new Error(
                `Gemini API key validation failed (${res.status}): ${body}`
            );
        }
        console.log(`  ✓ Gemini provider ready (model: ${this.model}, endpoint: ${this.endpoint})`);
    }

    adaptPrompt(prompt: string, _negative?: string): string {
        // Gemini models can't generate transparent PNGs.
        // Replace transparent background references with chroma-key green
        // so the user can remove the background in post-processing.
        let adapted = prompt;
        adapted = adapted.replace(
            /transparent\s+background/gi,
            "solid bright green chroma key background (#00FF00)"
        );
        adapted = adapted.replace(
            /transparent\s+BG/gi,
            "solid bright green chroma key background (#00FF00)"
        );
        // Also catch "Transparent background." or "transparent center"
        adapted = adapted.replace(
            /transparent\s+center/gi,
            "solid bright green chroma key center (#00FF00)"
        );
        return adapted;
    }

    async generate(
        prompt: ParsedPrompt,
        options?: GenerateOptions
    ): Promise<GeneratedImage> {
        const adaptedPrompt = this.adaptPrompt(prompt.prompt);

        if (this.endpoint === "predict") {
            return this.generatePredict(prompt, adaptedPrompt, options);
        }
        return this.generateContent(prompt, adaptedPrompt, options);
    }

    // ──────────────────────────────────────────────
    // :generateContent  (Gemini models)
    // ──────────────────────────────────────────────

    private async generateContent(
        prompt: ParsedPrompt,
        adaptedPrompt: string,
        _options?: GenerateOptions
    ): Promise<GeneratedImage> {
        const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

        const body: Record<string, unknown> = {
            contents: [
                {
                    parts: [{ text: adaptedPrompt }],
                },
            ],
            generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                    aspectRatio: prompt.aspectRatio,
                    imageSize: mapImageSize(prompt.width, prompt.height),
                },
            },
        };

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorBody = await res.text();
            throw new Error(
                `Gemini image generation failed for ${prompt.id} (${res.status}):\n${errorBody}`
            );
        }

        const data = (await res.json()) as {
            candidates?: Array<{
                content: {
                    parts: Array<{
                        text?: string;
                        inlineData?: { mimeType: string; data: string };
                    }>;
                };
                finishReason?: string;
            }>;
            promptFeedback?: { blockReason?: string };
        };

        if (data.promptFeedback?.blockReason) {
            throw new Error(
                `Gemini blocked prompt for ${prompt.id}: ${data.promptFeedback.blockReason}`
            );
        }

        if (!data.candidates || data.candidates.length === 0) {
            throw new Error(
                `Gemini returned no candidates for ${prompt.id}. The prompt may have been filtered.`
            );
        }

        const candidate = data.candidates[0];
        const imagePart = candidate.content?.parts?.find((p) => p.inlineData?.data);

        if (!imagePart?.inlineData) {
            const textParts = candidate.content?.parts
                ?.filter((p) => p.text)
                .map((p) => p.text)
                .join(" ");
            throw new Error(
                `Gemini returned no image data for ${prompt.id}.` +
                (textParts ? ` Response text: "${textParts.substring(0, 200)}"` : "") +
                (candidate.finishReason ? ` Finish reason: ${candidate.finishReason}` : "")
            );
        }

        const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");

        return {
            data: imageBuffer,
            mimeType: imagePart.inlineData.mimeType || "image/png",
            metadata: {
                model: this.model,
                endpoint: "generateContent",
                aspectRatio: prompt.aspectRatio,
                imageSize: mapImageSize(prompt.width, prompt.height),
                finishReason: candidate.finishReason,
                promptLength: adaptedPrompt.length,
            },
        };
    }

    // ──────────────────────────────────────────────
    // :predict  (Imagen models)
    // ──────────────────────────────────────────────

    private async generatePredict(
        prompt: ParsedPrompt,
        adaptedPrompt: string,
        options?: GenerateOptions
    ): Promise<GeneratedImage> {
        const sampleCount = options?.sampleCount ?? 1;
        const url = `${this.baseUrl}/models/${this.model}:predict?key=${this.apiKey}`;

        const body = {
            instances: [{ prompt: adaptedPrompt }],
            parameters: {
                sampleCount,
                aspectRatio: prompt.aspectRatio,
                outputOptions: {
                    mimeType: "image/png",
                },
            },
        };

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errorBody = await res.text();
            throw new Error(
                `Imagen generation failed for ${prompt.id} (${res.status}):\n${errorBody}`
            );
        }

        const data = (await res.json()) as {
            predictions?: Array<{
                bytesBase64Encoded: string;
                mimeType: string;
            }>;
        };

        if (!data.predictions || data.predictions.length === 0) {
            throw new Error(
                `Imagen returned no images for ${prompt.id}. The prompt may have been filtered.`
            );
        }

        const prediction = data.predictions[0];
        const imageBuffer = Buffer.from(prediction.bytesBase64Encoded, "base64");

        return {
            data: imageBuffer,
            mimeType: prediction.mimeType || "image/png",
            metadata: {
                model: this.model,
                endpoint: "predict",
                aspectRatio: prompt.aspectRatio,
                promptLength: adaptedPrompt.length,
            },
        };
    }
}
