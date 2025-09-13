# Cloudflare Workers OpenAPI 3.1

This is a Cloudflare Worker with OpenAPI 3.1 using [chanfana](https://github.com/cloudflare/chanfana) and [Hono](https://github.com/honojs/hono).

This is an example project made to be used as a quick start into building OpenAPI compliant Workers that generates the
`openapi.json` schema automatically from code and validates the incoming request to the defined parameters or request body.

## Get started

1. Sign up for [Cloudflare Workers](https://workers.dev). The free tier is more than enough for most use cases.
2. Clone this project and install dependencies with `npm install`
3. Run `wrangler login` to login to your Cloudflare account in wrangler
4. Run `wrangler deploy` to publish the API to Cloudflare Workers

## Project structure

1. Your main router is defined in `src/index.ts`.
2. Each endpoint has its own file in `src/endpoints/`.
3. For more information read the [chanfana documentation](https://chanfana.pages.dev/) and [Hono documentation](https://hono.dev/docs).

## Development

1. Run `wrangler dev` to start a local instance of the API.
2. Open `http://localhost:8787/` in your browser to see the Swagger interface where you can try the endpoints.
3. Changes made in the `src/` folder will automatically trigger the server to reload, you only need to refresh the Swagger interface.

## Sonic Flow Worker Configuration

Set these environment variables in `.dev.vars` or your Worker settings:

- `GROQ_API_KEY`: API key for Groq.
- `OPENAI_API_KEY`: API key for OpenAI (required if using OpenAI provider).
- `BASETEN_API_KEY`: API key for Baseten (required if using Baseten provider).
- `ENABLE_LLM`: `true|false` to enable post-LLM cleanup (default: true).
- `LLM_MODEL`: Chat model id (default from `src/config.ts`).
- `LLM_DEFAULT_PROVIDER` or `LLM_PROVIDER`: `groq|openai|baseten` (default: `baseten`).
- `LLM_CURRENT_DATE`: Optional current date string (YYYY-MM-DD) injected into the LLM system prompt; defaults to today's UTC date.
- `LLM_STREAM`: `true|false` stream deltas to client (default: true).
- `LLM_TIMEOUT_MS`: Request timeout override.
- `STT_MODEL`: STT model id (default from `src/config.ts`).
- `STT_LANGUAGE`: Default language code (client may override on `start`).
- `STT_PROMPT`: Optional STT vocab/prompt override.
- `STT_TIMEOUT_MS`: STT request timeout override.

See `src/config/runtime.ts` for parsing and defaults, and `src/services/*/prompt.ts` for prompt builders.

### Runtime Config Loader
- Use `getRuntimeConfig(env)` to read and normalize env values once per request.
- LLM prompt: use `buildLLMSystemPrompt({ model, currentDate })`.
- STT prompt: use `buildSTTPrompt()` or pass `STT_PROMPT`.

Example `.dev.vars` (add as needed):

```
# LLM
# ENABLE_LLM=true
# LLM_MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507
# LLM_PROVIDER=baseten # or groq | openai
# LLM_STREAM=true
# LLM_CURRENT_DATE=2025-09-01
# LLM_TIMEOUT_MS=25000

# STT
# STT_MODEL=whisper-large-v3
# STT_LANGUAGE=en
# STT_PROMPT=Your vocabulary includes: Sonic Flow, Sandheep...
# STT_TIMEOUT_MS=25000
```
