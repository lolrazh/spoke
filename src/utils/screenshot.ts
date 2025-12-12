/**
 * Screenshot Capture Utility
 * 
 * Provides screenshot capture capabilities using Electron's desktopCapturer API.
 * Used for OCR context extraction in Phase 1 of Context-Aware Transcription.
 */

import { desktopCapturer, screen, BrowserWindow } from "electron";

export interface ScreenshotResult {
    /** Base64-encoded PNG data (no data URI prefix) */
    imageBase64: string;
    /** Capture time in milliseconds */
    captureTimeMs: number;
    /** Approximate size in KB */
    sizeKb: number;
    /** Display ID that was captured */
    displayId: number;
    /** Display bounds */
    displayBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface ScreenshotOptions {
    /** 
     * Which display to capture. 
     * - 'active': The display containing the Spoke floating bar
     * - number: Specific display ID
     * Default: 'active'
     */
    display?: 'active' | number;

    /**
     * JPEG compression quality (0-100).
     * Lower = smaller file, worse quality.
     * Default: 75 (good balance for OCR)
     */
    quality?: number;

    /**
     * Maximum width/height. Image will be scaled down if larger.
     * Undefined = no scaling (full resolution)
     * Default: undefined (full resolution for now, can optimize later)
     */
    maxDimension?: number;
}

/**
 * Captures a screenshot of the specified display.
 * 
 * Performance target: <50ms for typical displays
 * 
 * @param options Screenshot configuration
 * @returns Screenshot result with base64 data and metrics
 */
export async function captureScreenshot(
    options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
    const startMs = Date.now();

    const {
        display = 'active',
        quality = 75,
        maxDimension,
    } = options;

    // Step 1: Determine target display
    const targetDisplay = getTargetDisplay(display);

    // Step 2: Capture screenshot using desktopCapturer
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
            width: targetDisplay.bounds.width * targetDisplay.scaleFactor,
            height: targetDisplay.bounds.height * targetDisplay.scaleFactor,
        },
    });

    // Find the source matching our target display
    const source = sources.find(s => {
        // desktopCapturer uses display.id.toString() as the source name suffix
        return s.name.includes(targetDisplay.id.toString()) ||
            s.display_id === targetDisplay.id.toString();
    });

    if (!source) {
        throw new Error(`Could not find screen source for display ${targetDisplay.id}`);
    }

    // Step 3: Get the thumbnail (this is our screenshot)
    let thumbnail = source.thumbnail;

    // Step 4: Optional scaling (for future optimization)
    if (maxDimension) {
        const size = thumbnail.getSize();
        if (size.width > maxDimension || size.height > maxDimension) {
            const scale = maxDimension / Math.max(size.width, size.height);
            const newWidth = Math.floor(size.width * scale);
            const newHeight = Math.floor(size.height * scale);
            thumbnail = thumbnail.resize({ width: newWidth, height: newHeight });
        }
    }

    // Step 5: Convert to JPEG (compressed, good for OCR)
    const jpegBuffer = thumbnail.toJPEG(quality);
    const imageBase64 = jpegBuffer.toString('base64');

    const captureTimeMs = Date.now() - startMs;
    const sizeKb = Math.round(jpegBuffer.length / 1024);

    return {
        imageBase64,
        captureTimeMs,
        sizeKb,
        displayId: targetDisplay.id,
        displayBounds: {
            x: targetDisplay.bounds.x,
            y: targetDisplay.bounds.y,
            width: targetDisplay.bounds.width,
            height: targetDisplay.bounds.height,
        },
    };
}

/**
 * Determines which display to capture based on options.
 */
function getTargetDisplay(display: 'active' | number): Electron.Display {
    if (display === 'active') {
        // Find the display containing the Spoke floating bar
        const floatingBar = BrowserWindow.getAllWindows().find(
            w => w.title === 'Spoke' || w.getTitle() === 'Spoke'
        );

        if (floatingBar) {
            const bounds = floatingBar.getBounds();
            const centerPoint = {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
            };
            return screen.getDisplayNearestPoint(centerPoint);
        }

        // Fallback: primary display
        return screen.getPrimaryDisplay();
    } else {
        // Specific display ID
        const displays = screen.getAllDisplays();
        const targetDisplay = displays.find(d => d.id === display);

        if (!targetDisplay) {
            throw new Error(`Display with ID ${display} not found`);
        }

        return targetDisplay;
    }
}

/**
 * Test function - captures a screenshot and logs metrics.
 * Can be called from DevTools console via IPC.
 */
export async function testScreenshotCapture(): Promise<{
    success: boolean;
    metrics?: {
        captureTimeMs: number;
        sizeKb: number;
        displayId: number;
        resolution: string;
    };
    error?: string;
}> {
    try {
        console.log('[Screenshot Test] Starting capture...');
        const result = await captureScreenshot();

        const metrics = {
            captureTimeMs: result.captureTimeMs,
            sizeKb: result.sizeKb,
            displayId: result.displayId,
            resolution: `${result.displayBounds.width}x${result.displayBounds.height}`,
        };

        console.log('[Screenshot Test] ✅ Success!', metrics);
        console.log(`[Screenshot Test] Base64 preview (first 100 chars): ${result.imageBase64.substring(0, 100)}...`);

        return { success: true, metrics };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Screenshot Test] ❌ Failed:', errorMsg);
        return { success: false, error: errorMsg };
    }
}
