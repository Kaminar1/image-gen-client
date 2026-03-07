import type { ImageProvider, ParsedPrompt, GenerateOptions, GeneratedImage } from "../types.js";

/**
 * Google Gemini image generation provider.
 *
 * Uses the Gemini API with responseModalities: ["IMAGE"] via generateContent.
 * Requires a GEMINI_API_KEY from https://aistudio.google.com/apikey
 *
 * API reference:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * Supported models for image output:
 *   - gemini-2.0-flash-exp          (text+image multimodal, supports image output)
 *   - imagen-3.0-generate-002       (dedicated image gen — uses :predict on Vertex, not supported here)
 */
export class GeminiProvider implements ImageProvider {
    readonly name = "gemini";

    private apiKey: string;
    private model: string;
    private baseUrl: string;

    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY ?? "";
        this.model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash-exp";
        this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
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
        console.log(`  ✓ Gemini provider ready (model: ${this.model})`);
    }

    adaptPrompt(prompt: string, _negative?: string): string {
        // Gemini generateContent takes natural language prompts.
        // Negative guidance is already embedded in our art-prompts.md text.
        return prompt;
    }

    async generate(
        prompt: ParsedPrompt,
        options?: GenerateOptions
    ): Promise<GeneratedImage> {
        const adaptedPrompt = this.adaptPrompt(prompt.prompt);

        const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

        // Use generateContent with responseModalities: ["IMAGE"] to get image output
        const body = {
            contents: [
                {
                    parts: [
                        {
                            text: adaptedPrompt,
                        },
                    ],
                },
            ],
            generationConfig: {
                responseModalities: ["IMAGE"],
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

        // Response shape for generateContent with image output:
        // { candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] }
        const data = (await res.json()) as {
            candidates?: Array<{
                content: {
                    parts: Array<{
                        text?: string;
                        inlineData?: {
                            mimeType: string;
                            data: string; // base64
                        };
                    }>;
                };
                finishReason?: string;
            }>;
            promptFeedback?: {
                blockReason?: string;
            };
        };

        // Check for content filtering
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

        // Find the first image part in the response
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
                aspectRatio: prompt.aspectRatio,
                finishReason: candidate.finishReason,
                promptLength: adaptedPrompt.length,
            },
        };
    }
}
