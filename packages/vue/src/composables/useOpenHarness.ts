import { Chat } from "@ai-sdk/vue";
import type { OHUIMessage } from "@openharness/core";
import { useOHContext } from "../context.js";
import { createOHTransport, type OHTransportOptions } from "../transport.js";

export interface UseOpenHarnessConfig extends OHTransportOptions {
  /** Your SSE endpoint URL. */
  endpoint: string;
  /** Stable chat ID for sharing state across components. */
  id?: string;
  /** Initial messages to populate the chat with (e.g. loaded from persistence). */
  messages?: OHUIMessage[];
  /** Called when the assistant message finishes streaming. */
  onFinish?: (message: OHUIMessage) => void;
}

/**
 * Primary composable for OpenHarness chat. Creates an AI SDK 5 `Chat`
 * instance with:
 * - `OHUIMessage` as the message type
 * - Transport pre-wired to your endpoint
 * - Data parts routed into the OpenHarnessProvider's event dispatcher
 *
 * The returned `Chat` instance has reactive properties (`messages`,
 * `status`, `error`) that work in templates and watchers.
 *
 * Must be used within an `<OpenHarnessProvider>`.
 */
export function useOpenHarness(config: UseOpenHarnessConfig): Chat<OHUIMessage> {
  const { dispatch } = useOHContext();

  const chat = new Chat<OHUIMessage>({
    id: config.id,
    messages: config.messages,
    transport: createOHTransport<OHUIMessage>(config.endpoint, config),
    onData: (part) => dispatch(part),
    onFinish: config.onFinish
      ? ({ message }) => config.onFinish!(message)
      : undefined,
  });

  return chat;
}
