import sharp from "sharp";

/**
 * Chroma-key background removal with despill.
 *
 * Four-pass algorithm:
 *
 *   Pass 1 — Flood-fill from image borders to find background-connected
 *            green pixels.
 *
 *   Pass 1b — Interior island scan.  Finds enclosed green regions
 *             (e.g. gaps between arms and torso) that the border fill
 *             didn't reach.  Any cluster of key-coloured pixels above
 *             a minimum size is also marked as background.
 *
 *   Pass 2 — Edge detection.  Foreground pixels adjacent to background
 *            get marked as edge (two layers deep).
 *
 *   Pass 3 — Alpha + Despill.  Background → transparent.  Edge pixels
 *            get compositing-equation-derived alpha with foreground
 *            colour estimation and green decontamination.
 */

export interface ChromaKeyOptions {
    /** Key colour to replace, as a hex string (default: "#00FF00") */
    keyColour?: string;
    /** Hard cutoff distance in RGB space (0-441). Pixels within this
     *  distance from the key become background candidates. Default: 60 */
    tolerance?: number;
    /** Soft-edge band beyond tolerance. Edge pixels between `tolerance`
     *  and `tolerance + softEdge` get proportional alpha. Default: 30 */
    softEdge?: number;
    /** Minimum cluster size (in pixels) for interior green islands to be
     *  treated as background.  Smaller clusters are assumed to be
     *  intentional green in the art.  Default: 16 */
    minIslandSize?: number;
}

// ── Helpers ──

/** Parse "#RRGGBB" to [R, G, B]. */
function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace("#", "");
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ];
}

/** Euclidean distance between two RGB colours. */
function colourDistance(
    r1: number, g1: number, b1: number,
    r2: number, g2: number, b2: number,
): number {
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Clamp a value to 0-255 integer range. */
function clamp(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v)));
}

// ── Pass 1: Flood-fill from borders ──

/**
 * Flood-fill from every border pixel that matches the key colour.
 * Returns a Uint8Array mask: 1 = background, 0 = foreground.
 */
function floodFillBackground(
    pixels: Uint8Array,
    width: number,
    height: number,
    keyR: number, keyG: number, keyB: number,
    tolerance: number,
): Uint8Array {
    const total = width * height;
    const bgMask = new Uint8Array(total); // 0 = fg, 1 = bg

    // Use an iterative flood-fill with a stack to avoid call-stack overflow
    const stack: number[] = [];

    // Seed with all border pixels that are close to the key colour
    for (let x = 0; x < width; x++) {
        // Top row
        stack.push(x);
        // Bottom row
        stack.push((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y++) {
        // Left column
        stack.push(y * width);
        // Right column
        stack.push(y * width + (width - 1));
    }

    while (stack.length > 0) {
        const idx = stack.pop()!;
        if (bgMask[idx]) continue; // already visited

        const off = idx * 4;
        const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
        const dist = colourDistance(r, g, b, keyR, keyG, keyB);

        if (dist > tolerance) continue; // not background

        bgMask[idx] = 1;

        // Spread to 4-connected neighbours
        const x = idx % width;
        const y = (idx - x) / width;
        if (x > 0) stack.push(idx - 1);
        if (x < width - 1) stack.push(idx + 1);
        if (y > 0) stack.push(idx - width);
        if (y < height - 1) stack.push(idx + width);
    }

    return bgMask;
}

// ── Pass 1b: Interior green island scan ──

/**
 * Find enclosed green regions that the border flood-fill missed.
 *
 * Scans every pixel not yet in bgMask.  When it finds an unvisited pixel
 * that matches the key colour, it flood-fills to measure the cluster.
 * If the cluster is ≥ `minSize` pixels, all its members are added to
 * bgMask as background.
 *
 * This catches:
 *  - Gaps between arms and torso
 *  - Holes in weapons / accessories
 *  - Any enclosed background region the model left green
 *
 * Small isolated green pixels (< minSize) are left alone — they're more
 * likely intentional art (e.g. green gems, eyes, foliage detail).
 */
function markInteriorIslands(
    pixels: Uint8Array,
    bgMask: Uint8Array,
    width: number,
    height: number,
    keyR: number, keyG: number, keyB: number,
    tolerance: number,
    minSize: number,
): void {
    const total = width * height;
    // Track which pixels we've already inspected in this scan
    const visited = new Uint8Array(total);

    // Copy existing bgMask into visited so we don't re-process those
    for (let i = 0; i < total; i++) {
        if (bgMask[i]) visited[i] = 1;
    }

    for (let seed = 0; seed < total; seed++) {
        if (visited[seed]) continue;

        const off = seed * 4;
        const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
        const dist = colourDistance(r, g, b, keyR, keyG, keyB);

        if (dist > tolerance) {
            visited[seed] = 1;
            continue;
        }

        // Flood-fill this cluster to measure its size and collect members
        const cluster: number[] = [];
        const stack: number[] = [seed];

        while (stack.length > 0) {
            const idx = stack.pop()!;
            if (visited[idx]) continue;
            visited[idx] = 1;

            const o = idx * 4;
            const cr = pixels[o], cg = pixels[o + 1], cb = pixels[o + 2];
            if (colourDistance(cr, cg, cb, keyR, keyG, keyB) > tolerance) continue;

            cluster.push(idx);

            const x = idx % width;
            const y = (idx - x) / width;
            if (x > 0) stack.push(idx - 1);
            if (x < width - 1) stack.push(idx + 1);
            if (y > 0) stack.push(idx - width);
            if (y < height - 1) stack.push(idx + width);
        }

        // If the cluster is large enough, mark it as background
        if (cluster.length >= minSize) {
            for (const idx of cluster) {
                bgMask[idx] = 1;
            }
        }
    }
}

// ── Pass 2 + 3: Alpha + Despill ──

/**
 * Estimate the foreground colour for an edge pixel by looking at nearby
 * interior (non-edge, non-bg) foreground pixels.  Falls back to the edge
 * pixel's own colour if no interior neighbours are found.
 */
function estimateForeground(
    idx: number,
    pixels: Uint8Array,
    width: number,
    height: number,
    bgMask: Uint8Array,
    edgeMask: Uint8Array,
    radius: number = 3,
): [number, number, number] {
    const x0 = idx % width;
    const y0 = (idx - x0) / width;

    let sumR = 0, sumG = 0, sumB = 0, count = 0;

    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x0 + dx, ny = y0 + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            // Only use interior foreground pixels (not bg, not edge)
            if (!bgMask[ni] && !edgeMask[ni]) {
                const no = ni * 4;
                sumR += pixels[no];
                sumG += pixels[no + 1];
                sumB += pixels[no + 2];
                count++;
            }
        }
    }

    if (count > 0) {
        return [
            Math.round(sumR / count),
            Math.round(sumG / count),
            Math.round(sumB / count),
        ];
    }

    // Fallback: no interior neighbours — use the pixel's own colour
    const off = idx * 4;
    return [pixels[off], pixels[off + 1], pixels[off + 2]];
}

/**
 * Given a pixel colour, a key colour, and an estimated foreground, solve
 * for the blend ratio (alpha) using the compositing model:
 *
 *   pixel = foreground × α  +  key × (1 - α)
 *   α = (pixel - key) / (foreground - key)
 *
 * We solve per-channel and take a weighted average, weighting channels by
 * how much the foreground differs from the key (larger Δ = more reliable).
 */
function solveAlpha(
    pr: number, pg: number, pb: number,
    kr: number, kg: number, kb: number,
    fr: number, fg: number, fb: number,
): number {
    let weightedSum = 0;
    let totalWeight = 0;

    const channels: [number, number, number][] = [
        [pr, kr, fr],
        [pg, kg, fg],
        [pb, kb, fb],
    ];

    for (const [p, k, f] of channels) {
        const denom = f - k;
        const absDenom = Math.abs(denom);
        if (absDenom < 5) continue; // channel too similar — unreliable
        const channelAlpha = (p - k) / denom;
        weightedSum += channelAlpha * absDenom;
        totalWeight += absDenom;
    }

    if (totalWeight < 1) {
        // All channels very similar to key — treat as background
        return 0;
    }

    return Math.max(0, Math.min(1, weightedSum / totalWeight));
}

/**
 * Remove the chroma-key background from a PNG buffer.
 * Returns a new PNG buffer with an alpha channel.
 */
export async function removeChromaKey(
    input: Buffer,
    options?: ChromaKeyOptions,
): Promise<Buffer> {
    const keyHex = options?.keyColour ?? "#00FF00";
    const tolerance = options?.tolerance ?? 60;
    const softEdge = options?.softEdge ?? 30;
    const minIslandSize = options?.minIslandSize ?? 16;

    const [keyR, keyG, keyB] = hexToRgb(keyHex);

    // Decode to raw RGBA pixel data
    const image = sharp(input).ensureAlpha();
    const { data, info } = await image
        .raw()
        .toBuffer({ resolveWithObject: true });

    const pixels = new Uint8Array(data.buffer, data.byteOffset, data.length);
    const width = info.width;
    const height = info.height;
    const totalPixels = width * height;

    // ── Pass 1: Flood-fill from borders to find background ──
    const bgMask = floodFillBackground(
        pixels, width, height,
        keyR, keyG, keyB,
        tolerance,
    );

    // ── Pass 1b: Find enclosed green islands not connected to borders ──
    markInteriorIslands(
        pixels, bgMask, width, height,
        keyR, keyG, keyB,
        tolerance,
        minIslandSize,
    );

    // ── Pass 2: Identify edge pixels (foreground adjacent to background) ──
    //
    // We mark TWO layers of edge pixels to handle wider anti-aliased fringes:
    //   edgeMask = 1  → directly adjacent to background
    //   edgeMask = 2  → one pixel further in (adjacent to layer 1)

    const edgeMask = new Uint8Array(totalPixels);

    // Layer 1: foreground pixels directly adjacent to background
    for (let i = 0; i < totalPixels; i++) {
        if (bgMask[i]) continue;
        const x = i % width;
        const y = (i - x) / width;
        outer1:
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                if (bgMask[ny * width + nx]) {
                    edgeMask[i] = 1;
                    break outer1;
                }
            }
        }
    }

    // Layer 2: foreground pixels adjacent to layer 1
    for (let i = 0; i < totalPixels; i++) {
        if (bgMask[i] || edgeMask[i]) continue;
        const x = i % width;
        const y = (i - x) / width;
        outer2:
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                if (edgeMask[ny * width + nx] === 1) {
                    edgeMask[i] = 2;
                    break outer2;
                }
            }
        }
    }

    // ── Pass 3: Process pixels ──

    for (let i = 0; i < totalPixels; i++) {
        const off = i * 4;

        if (bgMask[i]) {
            // Background → fully transparent, zero RGB to avoid fringe in
            // PNG viewers that blend with premultiplied data
            pixels[off] = 0;
            pixels[off + 1] = 0;
            pixels[off + 2] = 0;
            pixels[off + 3] = 0;
            continue;
        }

        if (!edgeMask[i]) continue; // interior foreground — leave as-is

        const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
        const dist = colourDistance(r, g, b, keyR, keyG, keyB);

        // Very close to key colour — make transparent even if on edge
        if (dist <= tolerance) {
            pixels[off] = 0;
            pixels[off + 1] = 0;
            pixels[off + 2] = 0;
            pixels[off + 3] = 0;
            continue;
        }

        // Estimate what the foreground colour should be from nearby
        // interior pixels, then solve for alpha and despill.
        const [fgR, fgG, fgB] = estimateForeground(
            i, pixels, width, height, bgMask, edgeMask,
        );

        // How different is the estimated foreground from the key?
        const fgKeyDist = colourDistance(fgR, fgG, fgB, keyR, keyG, keyB);

        if (fgKeyDist < 30) {
            // Estimated foreground is itself very close to the key colour —
            // we can't reliably separate them. Fall back to distance-based
            // alpha without despill.
            if (dist <= tolerance + softEdge) {
                const alpha = (dist - tolerance) / softEdge;
                pixels[off + 3] = clamp(pixels[off + 3] * alpha);
            }
            continue;
        }

        // Solve the compositing equation for alpha
        const alpha = solveAlpha(r, g, b, keyR, keyG, keyB, fgR, fgG, fgB);

        if (alpha < 0.02) {
            // Nearly fully background
            pixels[off] = 0;
            pixels[off + 1] = 0;
            pixels[off + 2] = 0;
            pixels[off + 3] = 0;
            continue;
        }

        if (alpha > 0.98) {
            // Nearly fully foreground on the edge — keep RGB, keep opaque
            continue;
        }

        // Despill: reverse compositing to recover the true foreground colour
        const oneMinusAlpha = 1 - alpha;
        pixels[off] = clamp((r - keyR * oneMinusAlpha) / alpha);
        pixels[off + 1] = clamp((g - keyG * oneMinusAlpha) / alpha);
        pixels[off + 2] = clamp((b - keyB * oneMinusAlpha) / alpha);
        pixels[off + 3] = clamp(pixels[off + 3] * alpha);
    }

    // Re-encode to PNG
    const output = await sharp(Buffer.from(pixels.buffer), {
        raw: {
            width,
            height,
            channels: 4,
        },
    })
        .png()
        .toBuffer();

    return output;
}

/**
 * Process an image file: remove chroma-key background and write result.
 * If `outputPath` is omitted, overwrites the input file.
 */
export async function processFile(
    inputPath: string,
    outputPath?: string,
    options?: ChromaKeyOptions,
): Promise<{ inputPath: string; outputPath: string; originalSize: number; newSize: number }> {
    const { readFile, writeFile } = await import("node:fs/promises");

    const inputBuffer = await readFile(inputPath);
    const result = await removeChromaKey(inputBuffer, options);

    const outPath = outputPath ?? inputPath;
    await writeFile(outPath, result);

    return {
        inputPath,
        outputPath: outPath,
        originalSize: inputBuffer.length,
        newSize: result.length,
    };
}
