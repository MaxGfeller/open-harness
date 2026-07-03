import { describe, expect, it, vi } from "vitest";
import { createChatGPTProvider } from "../provider.js";

describe("ChatGPT provider", () => {
  it("forces stateless Responses replay before OpenAI request serialization", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      requests.push(JSON.parse(init!.body as string) as Record<string, unknown>);
      return new Response("data: {}\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const model = createChatGPTProvider({
      fetch: fetchMock as typeof fetch,
      auth: {
        async getFreshToken() {
          return {
            type: "oauth",
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresAt: Date.now() + 60_000,
          };
        },
        async getAccountId() {
          return "account-id";
        },
      },
      transform: {
        codexInstructions: false,
      },
    })("gpt-5.5");

    await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Use the tool." }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_list_files",
              toolName: "listFiles",
              input: {},
              providerOptions: { openai: { itemId: "fc_list_files" } },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_list_files",
              toolName: "listFiles",
              output: { type: "json", value: ["README.md"] },
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          name: "listFiles",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      providerOptions: {
        openai: {
          store: true,
          include: ["file_search_call.results"],
        },
      },
    });

    expect(requests).toHaveLength(1);
    const body = requests[0]!;
    const input = body.input as Array<Record<string, unknown>>;
    const functionCalls = input.filter((item) => item.type === "function_call");
    const functionCallOutputs = input.filter(
      (item) => item.type === "function_call_output",
    );

    expect(body.store).toBe(false);
    expect(body.include).toEqual(["file_search_call.results", "reasoning.encrypted_content"]);
    expect(input.some((item) => item.type === "item_reference")).toBe(false);
    expect(functionCalls).toEqual([
      {
        type: "function_call",
        call_id: "call_list_files",
        name: "listFiles",
        arguments: "{}",
      },
    ]);
    expect(functionCallOutputs).toEqual([
      {
        type: "function_call_output",
        call_id: "call_list_files",
        output: "[\"README.md\"]",
      },
    ]);
  });
});
