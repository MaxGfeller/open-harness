import type { UIMessage, ModelMessage } from "ai";

/**
 * Extract user input from an AI SDK 5 UIMessage array, ready to pass
 * to `session.send()` or `session.toResponse()`.
 *
 * - Text-only → returns `string` (fast path, preserves existing behavior)
 * - Has files  → returns `ModelMessage[]` with properly decoded file data
 */
export async function extractUserInput(
  messages: UIMessage[],
): Promise<string | ModelMessage[]> {
  if (messages.length === 0) {
    throw new Error("extractUserInput: messages array is empty");
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    throw new Error(
      `extractUserInput: last message has role "${lastMessage.role}", expected "user"`,
    );
  }

  const hasFiles = lastMessage.parts.some((p) => p.type === "file");

  if (!hasFiles) {
    // Text-only fast path
    return lastMessage.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
  }

  // Has files — build ModelMessage manually so data URLs are decoded to
  // raw base64, which is what FilePart.data expects. convertToModelMessages
  // passes data URLs through as-is, causing providers to attempt an HTTP
  // download of the data: scheme which fails.
  const content: Array<{ type: "text"; text: string } | { type: "file"; data: string; mediaType: string; filename?: string }> = [];

  for (const part of lastMessage.parts) {
    if (part.type === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "file") {
      const filePart = part as { type: "file"; mediaType: string; url: string; filename?: string };
      content.push({
        type: "file",
        data: stripDataUrlPrefix(filePart.url),
        mediaType: filePart.mediaType,
        ...(filePart.filename ? { filename: filePart.filename } : {}),
      });
    }
  }

  return [{ role: "user", content }] as ModelMessage[];
}

/**
 * Strip the `data:<mediaType>;base64,` prefix from a data URL,
 * returning raw base64. Non-data URLs are returned as-is.
 */
function stripDataUrlPrefix(url: string): string {
  const match = url.match(/^data:[^;]+;base64,(.*)$/);
  return match ? match[1] : url;
}
