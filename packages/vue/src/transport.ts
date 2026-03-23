import { DefaultChatTransport, type ChatTransport, type UIMessage } from "ai";

export interface OHTransportOptions {
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  fetch?: typeof globalThis.fetch;
  body?: Record<string, unknown>;
}

/**
 * Create a pre-configured chat transport pointed at an OpenHarness SSE endpoint.
 * Returns a `DefaultChatTransport` that parses the AI SDK 5 data stream protocol.
 */
export function createOHTransport<UI_MESSAGE extends UIMessage = UIMessage>(
  endpoint: string,
  opts?: OHTransportOptions,
): ChatTransport<UI_MESSAGE> {
  return new DefaultChatTransport<UI_MESSAGE>({
    api: endpoint,
    headers: opts?.headers,
    credentials: opts?.credentials,
    fetch: opts?.fetch,
    body: opts?.body,
  });
}
