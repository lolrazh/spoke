import { describe, it, expect, vi } from "vitest";

vi.mock("./groq", () => ({
  chatComplete: vi.fn(async (opts: any) => ({
    text: "groq",
    timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 },
  })),
}));

vi.mock("./openai", () => ({
  chatComplete: vi.fn(async (opts: any) => ({
    text: "openai",
    timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 },
  })),
}));

vi.mock("./baseten", () => ({
  chatComplete: vi.fn(async (opts: any) => ({
    text: "baseten",
    timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 },
  })),
}));

vi.mock("./openrouter", () => ({
  chatComplete: vi.fn(async (opts: any) => ({
    text: "openrouter",
    timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 },
  })),
}));

import { chatCompleteByProvider } from "./index";
import { chatComplete as groqImpl } from "./groq";
import { chatComplete as openaiImpl } from "./openai";
import { chatComplete as basetenImpl } from "./baseten";
import { chatComplete as openrouterImpl } from "./openrouter";

describe("services/llm/index.chatCompleteByProvider", () => {
  it("dispatches to OpenAI when provider=openai", async () => {
    const res = await chatCompleteByProvider("openai", {
      apiKey: "k",
      userContent: "hi",
    });
    expect(res.text).toBe("openai");
    expect(openaiImpl).toHaveBeenCalledTimes(1);
    expect(groqImpl).not.toHaveBeenCalled();
  });

  it("dispatches to Groq when provider=groq", async () => {
    const res = await chatCompleteByProvider("groq", {
      apiKey: "k",
      userContent: "hi",
    });
    expect(res.text).toBe("groq");
    expect(groqImpl).toHaveBeenCalledTimes(1);
  });

  it("dispatches to Baseten when provider=baseten", async () => {
    const res = await chatCompleteByProvider("baseten", {
      apiKey: "k",
      userContent: "hi",
    });
    expect(res.text).toBe("baseten");
    expect(basetenImpl).toHaveBeenCalledTimes(1);
  });

  it("dispatches to OpenRouter when provider=openrouter", async () => {
    const res = await chatCompleteByProvider("openrouter", {
      apiKey: "k",
      userContent: "hi",
    });
    expect(res.text).toBe("openrouter");
    expect(openrouterImpl).toHaveBeenCalledTimes(1);
  });
});
