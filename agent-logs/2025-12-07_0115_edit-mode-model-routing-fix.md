# Edit Mode Model Routing Fix

**Date**: 2025-12-07  
**Status**: ✅ Fixed

---

## Problem

Edit mode was being routed to the **wrong LLM model**. Instead of using `<PROVIDER>_EDIT_LLM_DEFAULT_MODEL`, it was using `<PROVIDER>_LLM_DEFAULT_MODEL`.

For example, with Cerebras (the default provider):
- **Expected**: `qwen-3-235b-a22b-instruct-2507`
- **Actual (bug)**: `llama-3.3-70b`

---

## Root Cause

In `worker/src/config/runtime.ts`, line 124:

```typescript
const editModel = env.EDIT_LLM_MODEL || defaultModelFor(editProvider, EDIT_LLM_DEFAULT_MODEL);
```

The `defaultModelFor()` function was looking up models in `PROVIDER_DEFAULT_MODELS`:

```typescript
const PROVIDER_DEFAULT_MODELS: Record<LLMProvider, string> = {
  groq: GROQ_LLM_DEFAULT_MODEL,       // Regular model, NOT edit model!
  openai: OPENAI_LLM_DEFAULT_MODEL,
  baseten: BASETEN_LLM_DEFAULT_MODEL,
  openrouter: OPENROUTER_LLM_DEFAULT_MODEL,
  cerebras: CEREBRAS_LLM_DEFAULT_MODEL,
};
```

This map contained the **regular** models, not the edit models. The fallback parameter (`EDIT_LLM_DEFAULT_MODEL`) was only used if the provider wasn't in the map — which never happens since all providers are defined.

---

## The Fix

1. **Added a new map** for edit models:
```typescript
const PROVIDER_EDIT_MODELS: Record<LLMProvider, string> = {
  groq: GROQ_EDIT_LLM_DEFAULT_MODEL,
  openai: OPENAI_EDIT_LLM_DEFAULT_MODEL,
  baseten: BASETEN_EDIT_LLM_DEFAULT_MODEL,
  openrouter: OPENROUTER_EDIT_LLM_DEFAULT_MODEL,
  cerebras: CEREBRAS_EDIT_LLM_DEFAULT_MODEL,
};
```

2. **Added a dedicated function** for edit model lookup:
```typescript
function defaultEditModelFor(provider: LLMProvider, fallback: string): string {
  return PROVIDER_EDIT_MODELS[provider] ?? fallback;
}
```

3. **Updated the editModel resolution** to use the new function:
```typescript
const editModel = env.EDIT_LLM_MODEL || defaultEditModelFor(editProvider, EDIT_LLM_DEFAULT_MODEL);
```

---

## Files Changed

- `worker/src/config/runtime.ts`
  - Added imports for all `*_EDIT_LLM_DEFAULT_MODEL` constants
  - Added `PROVIDER_EDIT_MODELS` map
  - Added `defaultEditModelFor()` function
  - Changed `editModel` to use `defaultEditModelFor()` instead of `defaultModelFor()`

---

## Model Mapping Reference

| Provider    | Regular Model                              | Edit Model                          |
|-------------|-------------------------------------------|-------------------------------------|
| Cerebras    | `llama-3.3-70b`                           | `qwen-3-235b-a22b-instruct-2507`   |
| Groq        | `meta-llama/llama-4-maverick-17b-128e-instruct` | `moonshotai/kimi-k2-instruct-0905` |
| Baseten     | `deepseek-ai/DeepSeek-V3.2`               | `moonshotai/Kimi-K2-Instruct-0905` |
| OpenAI      | `gpt-4.1-mini`                            | `gpt-4.1-mini`                     |
| OpenRouter  | `qwen/qwen3-235b-a22b-2507`               | `qwen/qwen3-235b-a22b-2507`        |

---

## Verification

After deploying, check the worker logs for `edit.request` events. The `model` field should now show the correct edit model for the provider.

Example expected log:
```json
{
  "event": "edit.request",
  "provider": "cerebras",
  "model": "qwen-3-235b-a22b-instruct-2507",  // ← Correct!
  ...
}
```
