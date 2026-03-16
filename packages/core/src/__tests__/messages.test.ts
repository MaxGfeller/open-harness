import { describe, it, expect } from "vitest";
import { extractUserInput } from "../messages.js";
import type { UIMessage } from "ai";

function makeTextMessage(text: string, role: "user" | "assistant" = "user"): UIMessage {
  return {
    id: "msg-1",
    role,
    parts: [{ type: "text", text }],
  };
}

function makeFileMessage(
  mediaType: string,
  url: string,
  filename?: string,
  text?: string,
): UIMessage {
  const parts: UIMessage["parts"] = [];
  if (text) {
    parts.push({ type: "text", text });
  }
  parts.push({ type: "file", mediaType, url, filename });
  return {
    id: "msg-2",
    role: "user",
    parts,
  };
}

describe("extractUserInput", () => {
  it("returns string for text-only message", async () => {
    const result = await extractUserInput([makeTextMessage("hello world")]);
    expect(result).toBe("hello world");
  });

  it("concatenates multiple text parts", async () => {
    const msg: UIMessage = {
      id: "msg-1",
      role: "user",
      parts: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
      };
    const result = await extractUserInput([msg]);
    expect(result).toBe("hello world");
  });

  it("returns ModelMessage[] with stripped base64 for data URL files", async () => {
    const msg = makeFileMessage(
      "image/png",
      "data:image/png;base64,iVBOR",
      "test.png",
      "describe this image",
    );
    const result = await extractUserInput([msg]);
    expect(Array.isArray(result)).toBe(true);
    const messages = result as any[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const content = messages[0].content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "describe this image" });
    expect(content[1]).toEqual({
      type: "file",
      data: "iVBOR",
      mediaType: "image/png",
      filename: "test.png",
    });
  });

  it("returns ModelMessage[] for file-only (no text)", async () => {
    const msg = makeFileMessage("image/jpeg", "data:image/jpeg;base64,/9j/4A");
    const result = await extractUserInput([msg]);
    expect(Array.isArray(result)).toBe(true);
    const messages = result as any[];
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0].type).toBe("file");
    expect(messages[0].content[0].data).toBe("/9j/4A");
  });

  it("uses only the last message", async () => {
    const result = await extractUserInput([
      makeTextMessage("first message"),
      makeTextMessage("second message"),
    ]);
    expect(result).toBe("second message");
  });

  it("throws on empty array", async () => {
    await expect(extractUserInput([])).rejects.toThrow("messages array is empty");
  });

  it("throws when last message is not from user", async () => {
    await expect(
      extractUserInput([makeTextMessage("hi", "assistant")]),
    ).rejects.toThrow('expected "user"');
  });
});
