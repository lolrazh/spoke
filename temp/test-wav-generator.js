#!/usr/bin/env node

/**
 * Test WAV Generator - Matches Worker Logic Exactly
 * 
 * This script generates WAV files using the EXACT same logic as the CF Worker
 * to verify if our WAV construction is working correctly.
 */

const fs = require('fs');
const path = require('path');

function generateTestWAV(filename, durationMs = 2000) {
  console.log(`Generating test WAV: ${filename} (${durationMs}ms)`);

  // Simulate our Worker's PCM data
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const samplesCount = Math.floor((sampleRate * durationMs) / 1000);
  
  // Generate test PCM data (1kHz sine wave at low amplitude)
  const frequency = 1000;
  const amplitude = 8000; // -1 to 1 range scaled to 16-bit
  const testPcmData = new Uint8Array(samplesCount * 2); // 2 bytes per sample
  
  // Fill with sine wave data (as Int16 LE bytes)
  for (let i = 0; i < samplesCount; i++) {
    const t = i / sampleRate;
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * t));
    
    // Write as little-endian 16-bit signed
    const clampedSample = Math.max(-32768, Math.min(32767, sample));
    testPcmData[i * 2] = clampedSample & 0xFF;        // Low byte
    testPcmData[i * 2 + 1] = (clampedSample >> 8) & 0xFF; // High byte
  }

  console.log(`Generated ${testPcmData.length} PCM bytes (${samplesCount} samples)`);

  // ===== EXACT WORKER LOGIC STARTS HERE =====
  
  // Simulate the mergedPcm from worker
  const mergedPcm = testPcmData;
  
  // Build WAV with explicit little-endian (fixes endianness issues)
  // Ensure proper alignment by copying to a new buffer if needed
  let pcmSamples;
  if (mergedPcm.byteOffset % 2 === 0) {
    // Already aligned, can use directly
    pcmSamples = new Int16Array(mergedPcm.buffer, mergedPcm.byteOffset, mergedPcm.byteLength / 2);
  } else {
    // Not aligned, need to copy to aligned buffer
    const alignedBuffer = new ArrayBuffer(mergedPcm.byteLength);
    new Uint8Array(alignedBuffer).set(mergedPcm);
    pcmSamples = new Int16Array(alignedBuffer);
  }
  
  const wavBuffer = new ArrayBuffer(44 + pcmSamples.length * 2);
  const dv = new DataView(wavBuffer);

  const blockAlign = channels * (bitsPerSample >> 3);
  const byteRate = sampleRate * blockAlign;

  // Helper function for ASCII writing
  function writeAscii(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  // RIFF/WAVE header (little-endian)
  writeAscii(dv, 0, "RIFF");
  dv.setUint32(4, 36 + pcmSamples.length * 2, true);
  writeAscii(dv, 8, "WAVE");
  writeAscii(dv, 12, "fmt ");
  dv.setUint32(16, 16, true); // PCM fmt chunk size
  dv.setUint16(20, 1, true);  // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  writeAscii(dv, 36, "data");
  dv.setUint32(40, pcmSamples.length * 2, true);

  // Write PCM samples with explicit little-endian
  for (let i = 0; i < pcmSamples.length; i++) {
    dv.setInt16(44 + i * 2, pcmSamples[i], true);
  }

  const wavBytes = new Uint8Array(wavBuffer);

  // ===== EXACT WORKER LOGIC ENDS HERE =====

  // Debug logging - show ASCII header and sizes (same as worker)
  const headerAscii = String.fromCharCode(...wavBytes.slice(0, 12));
  const headerHex = Array.from(wavBytes.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const first64Hex = Array.from(wavBytes.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  
  console.log(`WAV header ASCII: "${headerAscii}"`);
  console.log(`WAV header hex: ${headerHex}`);
  console.log(`First 64 bytes hex: ${first64Hex}`);
  console.log(`WAV sizes: data=${pcmSamples.length * 2}, total=${wavBytes.byteLength}, sr=${sampleRate}, ch=${channels}, bits=${bitsPerSample}`);
  console.log(`PCM samples count: ${pcmSamples.length}, original bytes: ${mergedPcm.byteLength}`);

  // Write to file
  const outputPath = path.join(__dirname, filename);
  fs.writeFileSync(outputPath, wavBytes);
  
  console.log(`✅ WAV file written: ${outputPath}`);
  return outputPath;
}

// Generate test files
console.log('='.repeat(60));
console.log('TESTING WAV GENERATION WITH WORKER LOGIC');
console.log('='.repeat(60));

const testFiles = [
  generateTestWAV('test-2sec.wav', 2000),   // 2 second test
  generateTestWAV('test-0.5sec.wav', 500), // 0.5 second test
  generateTestWAV('test-5sec.wav', 5000),  // 5 second test
];

console.log('\n' + '='.repeat(60));
console.log('VERIFICATION COMMANDS:');
console.log('='.repeat(60));

testFiles.forEach(filePath => {
  const filename = path.basename(filePath);
  console.log(`\n# Test ${filename}:`);
  console.log(`ffprobe temp/${filename}`);
  console.log(`afplay temp/${filename}  # macOS - play the file`);
  console.log(`open temp/${filename}    # macOS - open in audio app`);
});

console.log(`\n# Direct Groq test (replace YOUR_API_KEY):`);
testFiles.forEach(filePath => {
  const filename = path.basename(filePath);
  console.log(`curl -X POST \\`);
  console.log(`  -H "Authorization: Bearer YOUR_GROQ_API_KEY" \\`);
  console.log(`  -F "file=@temp/${filename}" \\`);
  console.log(`  -F "model=whisper-large-v3-turbo" \\`);
  console.log(`  "https://api.groq.com/openai/v1/audio/transcriptions"`);
  console.log('');
});

console.log(`\n# Via AI Gateway:`);
testFiles.forEach(filePath => {
  const filename = path.basename(filePath);
  console.log(`curl -X POST \\`);
  console.log(`  -H "Authorization: Bearer YOUR_GROQ_API_KEY" \\`);
  console.log(`  -F "file=@temp/${filename}" \\`);
  console.log(`  -F "model=whisper-large-v3-turbo" \\`);
  console.log(`  "https://gateway.ai.cloudflare.com/v1/b738f434807b8a6fe9031a75c71d4393/sonic-flow/groq/audio/transcriptions"`);
  console.log('');
});

console.log('='.repeat(60));