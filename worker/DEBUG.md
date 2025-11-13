# Debug Worker Timeouts

## Quick Diagnosis

When dictation times out, use this script to instantly see if it's Groq (STT) or Baseten (LLM) causing the problem:

```bash
npm run dev:ws 2>&1 | ./debug-logs.sh
```

### What You'll See

**Normal flow:**
```
▶ STT START [groq] timeout=25000ms audio=156.42KB
✓ STT DONE in 1234ms (45 chars)
▶ LLM START [baseten/Qwen/Qwen3-235B-A22B-Instruct-2507] timeout=25000ms
✓ LLM DONE in 3456ms (52 chars)
```

**Groq timeout:**
```
▶ STT START [groq] timeout=25000ms audio=156.42KB
✗ STT ABORTED reason=timeout after 25001ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✗✗✗ PIPELINE FAILED ✗✗✗
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROBLEM: GROQ (STT)
  Error: AbortError
  → Groq transcription failed or timed out
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Baseten timeout:**
```
▶ STT START [groq] timeout=25000ms audio=156.42KB
✓ STT DONE in 1234ms (45 chars)
▶ LLM START [baseten/Qwen/Qwen3-235B-A22B-Instruct-2507] timeout=25000ms
✗ LLM ABORTED reason=timeout after 25002ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✗✗✗ PIPELINE FAILED ✗✗✗
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROBLEM: LLM (LLM)
  Error: AbortError
  STT completed: true
  → Baseten/LLM processing failed or timed out
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Alternative: Just grep

If you don't want the fancy colors, just grep for the important stuff:

```bash
# Watch for errors only
npm run dev:ws 2>&1 | grep -E "(abort|pipeline.error)"

# Watch the full pipeline
npm run dev:ws 2>&1 | grep -E "(stt\.|llm\.|edit\.)"
```

## Log Events Reference

| Event | What It Means |
|-------|---------------|
| `stt.request` | Groq transcription started |
| `stt.complete` | Groq transcription succeeded |
| `stt.abort` | Groq was aborted (timeout or external) |
| `llm.request` | LLM processing started |
| `llm.complete` | LLM processing succeeded |
| `llm.abort` | LLM was aborted (timeout or external) |
| `pipeline.error` | **THE IMPORTANT ONE** - tells you what failed |

## Quick Fixes

### If Groq (STT) is timing out:
```bash
# Increase STT timeout (default: 25000ms)
STT_TIMEOUT_MS=45000 npm run dev:ws
```

### If Baseten (LLM) is timing out:
```bash
# Increase LLM timeout (default: 25000ms)
LLM_TIMEOUT_MS=45000 npm run dev:ws

# Or disable LLM temporarily to test
ENABLE_LLM=false npm run dev:ws
```

### Try faster models:
```bash
# Use Groq's Llama instead of Baseten's Qwen
LLM_PROVIDER=groq npm run dev:ws
```
