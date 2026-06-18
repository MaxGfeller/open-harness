import { describe, it, expect, vi } from "vitest";
import { createOHTransport } from "../transport.js";

describe("createOHTransport", () => {
  it("passes custom reconnect request preparation to DefaultChatTransport", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const prepareReconnectToStreamRequest = vi.fn(({ id }) => ({
      api: `/api/tasks/${id}/chat/stream`,
      credentials: "same-origin" as const,
      headers: { "X-Reconnect": "1" },
    }));
    const transport = createOHTransport("/api/chat", {
      fetch,
      credentials: "include",
      prepareReconnectToStreamRequest,
    });

    const stream = await transport.reconnectToStream({
      chatId: "task-1",
      metadata: { source: "vue-test" },
    });

    expect(stream).toBeNull();
    expect(prepareReconnectToStreamRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "task-1",
        api: "/api/chat",
        credentials: "include",
        requestMetadata: { source: "vue-test" },
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/tasks/task-1/chat/stream",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        headers: expect.objectContaining({ "x-reconnect": "1" }),
      }),
    );
  });
});
