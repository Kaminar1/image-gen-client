import type { ImageProvider } from "../types.js";
import { GeminiProvider } from "./gemini.js";

/** Registry of available providers. Add new providers here. */
const providerFactories: Record<string, () => ImageProvider> = {
    gemini: () => new GeminiProvider(),
    // stability: () => new StabilityProvider(),
    // dalle:     () => new DalleProvider(),
    // comfyui:   () => new ComfyUIProvider(),
};

/**
 * Create a provider instance by name.
 */
export function createProvider(name: string): ImageProvider {
    const factory = providerFactories[name];
    if (!factory) {
        const available = Object.keys(providerFactories).join(", ");
        throw new Error(
            `Unknown provider "${name}". Available: ${available}`
        );
    }
    return factory();
}

/**
 * List all registered provider names.
 */
export function listProviders(): string[] {
    return Object.keys(providerFactories);
}
