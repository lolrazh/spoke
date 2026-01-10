import { describe, it, expect, vi } from "vitest";

vi.mock("./groq", () => ({
  chatComplete: vi.fn(async (opts: any) => ({
    text: "groq",
    timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 },
  })),
}));

vi.mock("./baseten", () => ({
  chatComplete: vi.fn(async (opts: any) => ({
    text: "baseten",
    timings: { startAt: 1, headersAt: 2, bodyDoneAt: 3 },
  })),
}));

import { chatCompleteByProvider } from "./index";
import { chatComplete as groqImpl } from "./groq";
import { chatComplete as basetenImpl } from "./baseten";

describe("services/llm/index.chatCompleteByProvider", () => {
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
});
