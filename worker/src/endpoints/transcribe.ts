import { OpenAPIRoute, Bool, Str } from "chanfana";
import { z } from "zod";
import type { Context } from "hono";
import { Buffer } from "node:buffer";

export class Transcribe extends OpenAPIRoute {
  schema = {
    tags: ["Transcription"],
    summary: "Transcribe audio (Groq Whisper or Workers AI)",
    request: {
      body: {
        content: {
          "multipart/form-data": {
            schema: z.object({
              file: z.any().optional(),
              audio: Str({ required: false, description: "Base64 audio string" }),
              language: Str({ required: false, description: "Language code, e.g., en" }),
              initial_prompt: Str({ required: false }),
              task: Str({ required: false, example: "transcribe" }),
              vad_filter: Bool({ required: false }),
            }),
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Transcription result",
        content: {
          "application/json": {
            schema: z.object({
              text: Str({ description: "Final transcript" }),
              vtt: Str({ required: false, description: "WebVTT captions" }),
              segments: z
                .array(
                  z.object({
                    start: z.number().optional(),
                    end: z.number().optional(),
                    text: Str(),
                  }),
                )
                .optional(),
              info: z.any().optional(),
            }),
          },
        },
      },
    },
  };

  async handle(c: Context) {
    try {
      const startTime = (c.get("startTime") as number) || Date.now();
      const form = await c.req.raw.formData();
      const uploadMs = Date.now() - startTime;

      let base64: string | null = null;
      const file = form.get("file");
      if (file && file instanceof Blob) {
        const buf = Buffer.from(await (file as Blob).arrayBuffer());
        base64 = buf.toString("base64");
      } else {
        const audio = form.get("audio");
        if (typeof audio === "string" && audio.trim()) base64 = audio.trim();
      }

      if (!base64) return c.json({ error: "No audio provided" }, 422);

      const language = str(form.get("language"));
      const initial_prompt = str(form.get("initial_prompt"));
      const task = str(form.get("task")) || "transcribe";
      const vad_filter = bool(form.get("vad_filter"));

      // Prefer Groq if the secret is present; otherwise fall back to Workers AI
      const groqKey = (c.env as any)?.GROQ_API_KEY as string | undefined;
      const useGroq = typeof groqKey === "string" && groqKey.length > 0;
      let result: any;
      const aiStart = Date.now();

      if (useGroq) {
        // Build a multipart request compatible with OpenAI's /audio/transcriptions
        // Prefer the uploaded file if present; else decode base64 back to a File
        let fileInput: File;
        if (file && file instanceof Blob) {
          const blob = file as Blob;
          fileInput = new File([blob], (blob as any).name || "audio.wav", {
            type: blob.type || "audio/wav",
          });
        } else {
          const bytes = base64ToBytes(base64!);
          const blob = new Blob([bytes], { type: "audio/wav" });
          fileInput = new File([blob], "audio.wav", { type: "audio/wav" });
        }

        const fd = new FormData();
        fd.set("file", fileInput);
        // Model can be overridden via env; default to a Whisper v3 variant
        const model = (c.env as any)?.GROQ_STT_MODEL || "whisper-large-v3";
        fd.set("model", model);
        if (language) fd.set("language", language);
        if (initial_prompt) fd.set("prompt", initial_prompt);
        // Ask for verbose JSON so we can forward segments when available
        fd.set("response_format", "verbose_json");

        const resp = await fetch(
          "https://api.groq.com/openai/v1/audio/transcriptions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${groqKey}`,
            },
            body: fd,
          },
        );
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Groq STT error ${resp.status}: ${body?.slice(0, 400)}`);
        }
        const groq = await resp.json();
        // Normalize to our response shape
        result = {
          text: groq?.text ?? "",
          vtt: null,
          segments: groq?.segments ?? null,
          transcription_info: groq, // keep raw for debugging
        };
      } else {
        const gateway = (c.env as any)?.AI_GATEWAY_ID
          ? { id: (c.env as any).AI_GATEWAY_ID }
          : undefined;
        result = await (c.env as any).AI.run(
          "@cf/openai/whisper-large-v3-turbo",
          { audio: base64, task, language, vad_filter, initial_prompt },
          gateway ? { gateway } : undefined,
        );
        result = {
          text: result?.text ?? "",
          vtt: result?.vtt ?? null,
          segments: result?.segments ?? null,
          transcription_info: result?.transcription_info ?? null,
        };
      }
      const aiMs = Date.now() - aiStart;

      // Attach timing segments and structured log fields
      try {
        const timings = (c.get("serverTimings") as string[]) || [];
        timings.push(`upload;dur=${uploadMs}`);
        timings.push(`ai;dur=${aiMs}`);
        const rtt = (c.req.raw as any)?.cf?.clientTcpRtt;
        if (typeof rtt === "number") timings.push(`rtt;dur=${rtt}`);
        c.set("serverTimings", timings);

        const sizeBytes = (() => {
          const f = form.get("file");
          if (f && f instanceof Blob) return (f as Blob).size;
          const audio = form.get("audio");
          if (typeof audio === "string") {
            const len = audio.length - (audio.endsWith("==") ? 2 : audio.endsWith("=") ? 1 : 0);
            return Math.floor((len * 3) / 4);
          }
          return undefined;
        })();

        const tls = (c.req.raw as any)?.cf?.tlsVersion;
        const proto = (c.req.raw as any)?.cf?.httpProtocol;

        c.set("log", {
          uploadMs,
          aiMs,
          sizeBytes,
          tls,
          proto,
          gateway: Boolean((c.env as any)?.AI_GATEWAY_ID),
        });
      } catch {}

      return c.json({
        text: result?.text ?? "",
        vtt: result?.vtt ?? null,
        segments: result?.segments ?? null,
        info: result?.transcription_info ?? null,
      });
    } catch (err: any) {
      return c.json({ error: err?.message || String(err) }, 500);
    }
  }
}

function str(x: FormDataEntryValue | null): string | undefined {
  return typeof x === "string" && x.trim() ? x.trim() : undefined;
}

function bool(x: FormDataEntryValue | null): boolean | undefined {
  if (typeof x !== "string") return undefined;
  const v = x.toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}

function base64ToBytes(b64: string): Uint8Array {
  // atob/btoa available in Workers runtime
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
