import { describe, it, expect, vi } from "vitest";
import { createOHTransport } from "../transport.js";

describe("createOHTransport", () => {
  it("returns a transport object", () => {
    const transport = createOHTransport("/api/chat");
    expect(transport).toBeTruthy();
    expect(typeof transport.sendMessages).toBe("function");
  });

  it("accepts custom options", () => {
    const transport = createOHTransport("/api/agent/stream", {
      headers: { Authorization: "Bearer test" },
      credentials: "include",
    });
    expect(transport).toBeTruthy();
  });

  it("uses the AI SDK default reconnect endpoint when resuming streams", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const transport = createOHTransport("/api/chat", { fetch });

    const stream = await transport.reconnectToStream({ chatId: "chat-1" });

    expect(stream).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/chat/chat-1/stream",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("passes custom reconnect request preparation to DefaultChatTransport", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const prepareReconnectToStreamRequest = vi.fn(({ id, headers }) => ({
      api: `/api/tasks/${id}/chat/stream`,
      credentials: "same-origin" as const,
      headers: {
        ...(headers as Record<string, string>),
        "X-Reconnect": "1",
      },
    }));
    const transport = createOHTransport("/api/chat", {
      fetch,
      credentials: "include",
      headers: { "X-Base": "1" },
      body: { stable: true },
      prepareReconnectToStreamRequest,
    });

    const stream = await transport.reconnectToStream({
      chatId: "task-1",
      body: { requestScoped: true },
      headers: { "X-Request": "2" },
      metadata: { source: "test" },
    });

    expect(stream).toBeNull();
    expect(prepareReconnectToStreamRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "task-1",
        api: "/api/chat",
        body: { stable: true, requestScoped: true },
        credentials: "include",
        headers: expect.objectContaining({
          "x-base": "1",
          "x-request": "2",
        }),
        requestMetadata: { source: "test" },
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/tasks/task-1/chat/stream",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "x-base": "1",
          "x-request": "2",
          "x-reconnect": "1",
        }),
      }),
    );
  });
});
