"use client";

import type { OHUIMessage } from "@openharness/core";

export function MessageBubble({ message }: { message: OHUIMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          padding: "0.6rem 0.9rem",
          borderRadius: 12,
          background: isUser ? "#333" : "#f2f2f2",
          color: isUser ? "#fff" : "#222",
          fontSize: "0.95rem",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message.parts.map((part, i) => {
          switch (part.type) {
            case "text":
              return <span key={i}>{part.text}</span>;

            case "reasoning":
              return (
                <details
                  key={i}
                  style={{
                    fontSize: "0.85rem",
                    color: "#666",
                    marginBottom: "0.4rem",
                  }}
                >
                  <summary style={{ cursor: "pointer" }}>Reasoning</summary>
                  <p style={{ margin: "0.25rem 0", whiteSpace: "pre-wrap" }}>
                    {part.text}
                  </p>
                </details>
              );

            default: {
              // Handle tool parts (type: "tool-*" or "dynamic-tool")
              if (
                part.type.startsWith("tool-") ||
                part.type === "dynamic-tool"
              ) {
                const toolPart = part as {
                  type: string;
                  toolCallId: string;
                  state: string;
                };
                const toolName =
                  part.type === "dynamic-tool"
                    ? (part as any).toolName ?? "tool"
                    : part.type.replace("tool-", "");
                return (
                  <div
                    key={i}
                    style={{
                      fontSize: "0.8rem",
                      padding: "0.4rem 0.6rem",
                      margin: "0.3rem 0",
                      background: isUser
                        ? "rgba(255,255,255,0.1)"
                        : "#e8e8e8",
                      borderRadius: 6,
                      fontFamily: "monospace",
                    }}
                  >
                    <strong>{toolName}</strong>
                    {toolPart.state === "output" && (
                      <span style={{ color: "#4a4" }}> (done)</span>
                    )}
                    {(toolPart.state === "input-streaming" ||
                      toolPart.state === "input-available" ||
                      toolPart.state === "call") && (
                      <span style={{ color: "#888" }}> (running...)</span>
                    )}
                  </div>
                );
              }
              return null;
            }
          }
        })}
      </div>
    </div>
  );
}
