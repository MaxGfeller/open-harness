import { describe, it, expect } from "vitest";
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
});
