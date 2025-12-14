# Screenshot Capture PoC Test Results

**Date:** 2025-12-12  
**Phase:** 1.1 - Client-Side Screenshot Capture  
**Purpose:** Validate `desktopCapturer` performance on macOS

---

## How to Test

### Option 1: DevTools Console (Recommended)

1. **Build and run the app:**
   ```bash
   npm start
   ```

2. **Open DevTools:**
   - Press `Cmd+Option+I` when the Spoke window is focused
   - Or right-click the Spoke bar → "Inspect Element"

3. **Run test in console:**
   ```javascript
   await window.electron.testScreenshot()
   ```

4. **Expected output:**
   ```javascript
   {
     success: true,
     metrics: {
       captureTimeMs: 45,    // ✅ Target: <50ms
       sizeKb: 234,          // Typically 100-300KB
       displayId: 123456789,
       resolution: "2560x1440"
     }
   }
   ```

### Option 2: Capture with Custom Options

```javascript
const result = await window.electron.takeScreenshot({
  quality: 75,           // JPEG quality (0-100)
  display: 'active',     // 'active' or specific display ID
  // maxDimension: 1920   // Optional: scale down if larger
});

console.log('Capture time:', result.captureTimeMs + 'ms');
console.log('File size:', result.sizeKb + 'KB');
console.log('Preview (first 100 chars):', result.imageBase64.substring(0, 100));
```

---

## Performance Targets

| Metric | Target | Acceptable | Needs Optimization |
|--------|--------|------------|-------------------|
| **Capture Time** | <50ms | 50-100ms | >100ms |
| **File Size** | 100-300KB | 300-500KB | >500KB |
| **Resolution** | Native | Native | Scaled |

---

## Test Results

### Test 1: Default Settings
- **Date/Time:** _[Fill in after testing]_
- **Capture Time:** ___ ms
- **File Size:** ___ KB
- **Display Resolution:** ___ x ___
- **Display ID:** ___
- **✅ / ❌ Pass/Fail:**

### Test 2: Quality 50 (Lower compression)
```javascript
await window.electron.takeScreenshot({ quality: 50 })
```
- **Capture Time:** ___ ms
- **File Size:** ___ KB

### Test 3: Quality 90 (Higher quality)
```javascript
await window.electron.takeScreenshot({ quality: 90 })
```
- **Capture Time:** ___ ms
- **File Size:** ___ KB

---

## Decision Points

### ✅ Proceed with `desktopCapturer` if:
- Capture time is consistently <50ms
- File sizes are reasonable (100-300KB)
- Works reliably across multiple tests

### ⚠️ Consider Optimization if:
- Capture time is 50-100ms (still acceptable but room for improvement)
- File sizes are 300-500KB (may want to reduce quality/resolution)

### 🚨 Evaluate Native APIs if:
- Capture time is >100ms
- File sizes are >500KB
- Frequent errors or inconsistent behavior
- In this case, we should research `ScreenCaptureKit` integration

---

## Next Steps After Testing

If tests pass:
1. ✅ Mark Milestone 1.1 as complete
2. Continue to Milestone 1.2: Worker OCR Endpoint
3. Integrate screenshot capture into PTT flow

If tests fail:
1. Document specific issues
2. Research alternative approaches (ScreenCaptureKit, native addon)
3. Re-evaluate implementation strategy

---

## Console Debugging

Check main process logs for detailed timing:
```bash
# In your terminal running npm start, look for:
[Screenshot] Captured in XXms, size: XXXKB
```

---

## Notes

- **Why JPEG?** Smaller file size than PNG, OCR doesn't need lossless quality
- **Why quality 75?** Sweet spot between file size and OCR accuracy
- **Why active display?** Most relevant context is where the user is working
- **Screen Recording Permission:** macOS may prompt for screen recording permission on first run

---

## Troubleshooting

### Error: "Could not find screen source"
- **Cause:** Display detection failed
- **Solution:** Check that Spoke bar is visible on a real display (not hidden)

### Error: "Screen recording permission denied"
- **Cause:** macOS permissions not granted
- **Solution:** System Preferences → Security & Privacy → Screen Recording → Enable for Spoke

### Blank/black screenshot
- **Cause:** Timing issue or permission issue
- **Solution:** Ensure app is in foreground, retry after granting permissions
