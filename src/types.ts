// ── Parsed prompt from art-prompts.md ──

export interface ParsedPrompt {
    /** Asset ID, e.g. "CHR-01", "ICN-05", "BG-03", "BOSS-02", "UI-01" */
    id: string;
    /** Human name, e.g. "Harbinger (idle)", "Bone", "Hamlet" */
    name: string;
    /** Section category, e.g. "Characters", "Resource Icons", "Backgrounds" */
    category: string;
    /** Target width in pixels */
    width: number;
    /** Target height in pixels */
    height: number;
    /** The raw prompt text from the code block */
    prompt: string;
    /** Closest supported aspect ratio for the provider */
    aspectRatio: string;
    /** Output format hint from the section header */
    formatHint: string;
}

// ── Provider interface ──

export interface GenerateOptions {
    /** Number of images to generate per prompt (default: 1) */
    sampleCount?: number;
    /** Provider-specific overrides */
    providerOptions?: Record<string, unknown>;
}

export interface GeneratedImage {
    /** Raw image bytes */
    data: Buffer;
    /** MIME type of the image */
    mimeType: string;
    /** Provider-specific metadata (e.g. seed, model version) */
    metadata?: Record<string, unknown>;
}

export interface ImageProvider {
    /** Provider name for display and selection */
    readonly name: string;

    /** Initialize the provider (validate API key, etc.) */
    init(): Promise<void>;

    /** Generate an image from a prompt */
    generate(
        prompt: ParsedPrompt,
        options?: GenerateOptions
    ): Promise<GeneratedImage>;

    /**
     * Adapt a raw prompt string for this provider's format.
     * E.g. split negative prompts, add provider-specific flags.
     */
    adaptPrompt(prompt: string, negative?: string): string;
}

// ── CLI options ──

export interface RunOptions {
    /** Path to the art-prompts.md file */
    inputFile: string;
    /** Output directory for generated images */
    outputDir: string;
    /** Provider to use */
    provider: string;
    /** Only generate these IDs (empty = all) */
    ids: string[];
    /** Only generate prompts in these categories */
    categories: string[];
    /** Overwrite existing files */
    force: boolean;
    /** Preview without calling APIs */
    dryRun: boolean;
    /** Delay between API calls in ms */
    delayMs: number;
    /** Number of images per prompt */
    sampleCount: number;
}
