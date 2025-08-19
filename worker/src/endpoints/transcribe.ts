import { OpenAPIRoute, Bool, Str } from "chanfana";
import { z } from "zod";
import type { Context } from "hono";
import { Buffer } from "node:buffer";

export class Transcribe extends OpenAPIRoute {
  schema = {
    tags: ["Transcription"],
    summary: "Transcribe audio with Workers AI (Whisper v3 Turbo)",
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
      const form = await c.req.raw.formData();

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

      const gateway = (c.env as any)?.AI_GATEWAY_ID
        ? { id: (c.env as any).AI_GATEWAY_ID }
        : undefined;

      const result: any = await (c.env as any).AI.run(
        "@cf/openai/whisper-large-v3-turbo",
        { audio: base64, task, language, vad_filter, initial_prompt },
        gateway ? { gateway } : undefined,
      );

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
