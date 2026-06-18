import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OHUIMessage } from "@openharness/core";

const {
  chatConstructorOptions,
  dispatchMock,
  onMountedMock,
  resumeStreamMock,
} = vi.hoisted(() => ({
  chatConstructorOptions: [] as any[],
  dispatchMock: vi.fn(),
  onMountedMock: vi.fn(),
  resumeStreamMock: vi.fn(),
}));

vi.mock("@ai-sdk/vue", () => ({
  Chat: class MockChat {
    resumeStream = resumeStreamMock;

    constructor(options: any) {
      chatConstructorOptions.push(options);
    }
  },
}));

vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue")>()),
  onMounted: onMountedMock,
}));

vi.mock("../context.js", () => ({
  useOHContext: () => ({ dispatch: dispatchMock }),
}));

import { useOpenHarness } from "../composables/useOpenHarness.js";

describe("useOpenHarness", () => {
  beforeEach(() => {
    chatConstructorOptions.length = 0;
    dispatchMock.mockReset();
    onMountedMock.mockReset();
    resumeStreamMock.mockReset();
    onMountedMock.mockImplementation((callback: () => void) => callback());
  });

  it("creates an OpenHarness chat and forwards data parts to the provider", () => {
    const messages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "hello" }],
      },
    ] as OHUIMessage[];
    const onFinish = vi.fn();

    useOpenHarness({
      endpoint: "/api/chat",
      id: "chat-1",
      messages,
      onFinish,
    });

    const options = chatConstructorOptions[0];
    expect(options.id).toBe("chat-1");
    expect(options.messages).toBe(messages);
    expect(options.transport).toBeTruthy();

    const dataPart = {
      type: "data-oh:turn.start",
      data: { turnIndex: 1 },
    };
    options.onData(dataPart);
    expect(dispatchMock).toHaveBeenCalledWith(dataPart);

    const message = messages[0];
    options.onFinish({ message });
    expect(onFinish).toHaveBeenCalledWith(message);
  });

  it("resumes the chat stream on mount when configured", () => {
    useOpenHarness({
      endpoint: "/api/chat",
      id: "chat-1",
      resume: true,
    });

    expect(onMountedMock).toHaveBeenCalledTimes(1);
    expect(resumeStreamMock).toHaveBeenCalledTimes(1);
  });

  it("does not resume by default", () => {
    useOpenHarness({
      endpoint: "/api/chat",
      id: "chat-1",
    });

    expect(onMountedMock).not.toHaveBeenCalled();
    expect(resumeStreamMock).not.toHaveBeenCalled();
  });
});
