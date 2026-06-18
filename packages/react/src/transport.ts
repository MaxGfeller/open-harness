import {
  DefaultChatTransport,
  type ChatTransport,
  type HttpChatTransportInitOptions,
  type UIMessage,
} from "ai";

export type OHTransportOptions<UI_MESSAGE extends UIMessage = UIMessage> = Pick<
  HttpChatTransportInitOptions<UI_MESSAGE>,
  | "headers"
  | "credentials"
  | "fetch"
  | "body"
  | "prepareSendMessagesRequest"
  | "prepareReconnectToStreamRequest"
>;

/**
 * Create a pre-configured chat transport pointed at an OpenHarness SSE endpoint.
 * Returns a `DefaultChatTransport` that parses the AI SDK 5 data stream protocol.
 */
export function createOHTransport<UI_MESSAGE extends UIMessage = UIMessage>(
  endpoint: string,
  opts?: OHTransportOptions<UI_MESSAGE>,
): ChatTransport<UI_MESSAGE> {
  return new DefaultChatTransport<UI_MESSAGE>({
    api: endpoint,
    headers: opts?.headers,
    credentials: opts?.credentials,
    fetch: opts?.fetch,
    body: opts?.body,
    prepareSendMessagesRequest: opts?.prepareSendMessagesRequest,
    prepareReconnectToStreamRequest: opts?.prepareReconnectToStreamRequest,
  });
}
