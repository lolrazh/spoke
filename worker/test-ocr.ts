/**
 * Test OCR extraction with a sample image
 * 
 * Usage:
 *   1. Place test image in worker/ directory (e.g., test-screenshot.jpg)
 *   2. Set GROQ_API_KEY environment variable
 *   3. Run: npx tsx test-ocr.ts
 */

import { readFileSync } from 'fs';
import { extractOcrWords } from './src/services/ocr/index';

// Load .dev.vars if GROQ_API_KEY not in env
function loadDevVars() {
    try {
        const devVars = readFileSync('.dev.vars', 'utf-8');
        devVars.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
                const value = valueParts.join('=').trim();
                if (!process.env[key.trim()]) {
                    process.env[key.trim()] = value;
                }
            }
        });
    } catch (e) {
        // .dev.vars not found, that's ok
    }
}

async function testOcr() {
    loadDevVars();
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        console.error('❌ Missing GROQ_API_KEY environment variable');
        console.log('Set it in .dev.vars or export it:');
        console.log('  export GROQ_API_KEY=your_key_here');
        process.exit(1);
    }

    const imagePath = process.argv[2] || './test-screenshot.jpg';

    try {
        console.log(`[OCR Test] Reading image: ${imagePath}`);
        const imageBuffer = readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString('base64');

        console.log(`[OCR Test] Image size: ${Math.round(imageBuffer.length / 1024)}KB`);
        console.log(`[OCR Test] Calling Groq OCR...`);

        const startMs = Date.now();
        const result = await extractOcrWords({
            apiKey,
            imageBase64,
        });
        const durationMs = Date.now() - startMs;

        console.log(`\n✅ OCR completed in ${durationMs}ms`);
        console.log(`📝 Extracted ${result.words.length} words:`);
        console.log(JSON.stringify(result.words, null, 2));

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

testOcr();
