// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import type { OHUIMessage } from "@openharness/core";
import { OpenHarnessProvider } from "../provider.js";
import { useOpenHarness } from "../hooks/use-open-harness.js";

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <OpenHarnessProvider>{children}</OpenHarnessProvider>;
}

function createMockHelpers(overrides: Record<string, unknown> = {}) {
  return {
    id: "chat-1",
    messages: [] as OHUIMessage[],
    setMessages: vi.fn(),
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
    resumeStream: vi.fn(),
    addToolResult: vi.fn(),
    addToolOutput: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    status: "ready",
    clearError: vi.fn(),
    error: undefined,
    ...overrides,
  };
}

describe("useOpenHarness", () => {
  const mockedUseChat = vi.mocked(useChat);

  beforeEach(() => {
    mockedUseChat.mockReset();
  });

  it("forwards the full onFinish callback to useChat", () => {
    const helpers = createMockHelpers();
    let options: any;
    mockedUseChat.mockImplementation((nextOptions: any) => {
      options = nextOptions;
      return helpers as any;
    });

    const onFinish = vi.fn();
    renderHook(
      () =>
        useOpenHarness({
          endpoint: "/api/chat",
          onFinish,
        }),
      { wrapper },
    );

    const message = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "hello" }],
    } as OHUIMessage;
    const event = {
      message,
      messages: [message],
      isAbort: true,
      isDisconnect: false,
      isError: false,
      finishReason: "stop" as const,
    };

    options.onFinish(event);

    expect(onFinish).toHaveBeenCalledWith(event);
  });

  it("hydrates persisted messages that arrive after the first render", async () => {
    const persistedMessages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "persisted" }],
      },
    ] as OHUIMessage[];
    const helpers = createMockHelpers();
    mockedUseChat.mockReturnValue(helpers as any);

    const { rerender } = renderHook(
      ({ messages }) =>
        useOpenHarness({
          endpoint: "/api/chat",
          messages,
        }),
      {
        initialProps: { messages: undefined as OHUIMessage[] | undefined },
        wrapper,
      },
    );

    expect(helpers.setMessages).not.toHaveBeenCalled();

    rerender({ messages: persistedMessages });

    await waitFor(() => {
      expect(helpers.setMessages).toHaveBeenCalledWith(persistedMessages);
    });
  });

  it("does not overwrite an active local chat with hydrated messages", async () => {
    const persistedMessages = [
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "persisted" }],
      },
    ] as OHUIMessage[];
    const helpers = createMockHelpers({
      messages: [
        {
          id: "local-1",
          role: "user",
          parts: [{ type: "text", text: "live local state" }],
        },
      ] as OHUIMessage[],
    });
    mockedUseChat.mockReturnValue(helpers as any);

    renderHook(
      () =>
        useOpenHarness({
          endpoint: "/api/chat",
          messages: persistedMessages,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(helpers.setMessages).not.toHaveBeenCalled();
    });
  });
});
