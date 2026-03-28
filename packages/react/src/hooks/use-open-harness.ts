import { useEffect, useRef } from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import type { OHUIMessage } from "@openharness/core";
import { useOHContext } from "../context.js";
import { createOHTransport, type OHTransportOptions } from "../transport.js";

export interface UseOpenHarnessFinishEvent {
  message: OHUIMessage;
  messages: OHUIMessage[];
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  finishReason?: string;
}

export interface UseOpenHarnessConfig extends OHTransportOptions {
  /** Your SSE endpoint URL. */
  endpoint: string;
  /** Stable chat ID for sharing state across components. */
  id?: string;
  /** Initial messages to populate the chat with (e.g. loaded from persistence). */
  messages?: OHUIMessage[];
  /** Called when the assistant message finishes streaming, including abort/error metadata. */
  onFinish?: (event: UseOpenHarnessFinishEvent) => void;
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
  const chat = useChat<OHUIMessage>({
    id: config.id,
    messages: config.messages,
    transport: createOHTransport<OHUIMessage>(config.endpoint, config),
    onData: (part) => dispatch(part),
    onFinish: config.onFinish,
  });
  const hydratedChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!config.messages?.length) return;
    if (hydratedChatIdRef.current === chat.id) return;
    if (chat.messages.length > 0) return;

    chat.setMessages(config.messages);
    hydratedChatIdRef.current = chat.id;
  }, [chat.id, chat.messages.length, chat.setMessages, config.messages]);

  return chat;
}
