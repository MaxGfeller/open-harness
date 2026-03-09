import { useRef } from "react";
import { useChat, type UseChatHelpers, Chat } from "@ai-sdk/react";
import type { OHUIMessage } from "@openharness/core";
import { useOHContext } from "../context.js";
import { createOHTransport, type OHTransportOptions } from "../transport.js";

export interface UseOpenHarnessConfig extends OHTransportOptions {
  /** Your SSE endpoint URL. */
  endpoint: string;
  /** Stable chat ID for sharing state across components. */
  id?: string;
  /** Called when the assistant message finishes streaming. */
  onFinish?: (message: OHUIMessage) => void;
}

/**
 * Primary hook for OpenHarness chat. Wraps AI SDK 5's `useChat` with:
 * - `OHUIMessage` as the message type
 * - Transport pre-wired to your endpoint
 * - Data parts routed into the OpenHarnessProvider's event dispatcher
 *
 * Must be used within an `<OpenHarnessProvider>`.
 */
export function useOpenHarness(
  config: UseOpenHarnessConfig,
): UseChatHelpers<OHUIMessage> {
  const { dispatch } = useOHContext();

  // Create a stable Chat instance so useChat doesn't recreate on every render
  const chatRef = useRef<Chat<OHUIMessage> | null>(null);
  if (!chatRef.current) {
    chatRef.current = new Chat<OHUIMessage>({
      id: config.id,
      transport: createOHTransport<OHUIMessage>(config.endpoint, config),
      onData: (part) => dispatch(part),
      onFinish: config.onFinish
        ? ({ message }) => config.onFinish!(message)
        : undefined,
    });
  }

  return useChat<OHUIMessage>({ chat: chatRef.current });
}
