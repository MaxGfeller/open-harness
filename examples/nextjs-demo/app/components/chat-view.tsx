"use client";

import { useState, useRef, useEffect } from "react";
import {
  useOpenHarness,
  useSubagentStatus,
  useSessionStatus,
} from "@openharness/react";
import type { OHUIMessage } from "@openharness/core";
import { StatusBar } from "./status-bar";
import { MessageBubble } from "./message-bubble";

export function ChatView() {
  const { messages, sendMessage, status, stop } = useOpenHarness({
    endpoint: "/api/chat",
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const subagent = useSubagentStatus();
  const session = useSessionStatus();

  const isStreaming = status === "streaming" || status === "submitted";

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ text });
  }

  return (
    <>
      <StatusBar
        subagent={subagent}
        session={session}
        isStreaming={isStreaming}
      />

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          paddingBottom: "1rem",
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "#888", textAlign: "center", marginTop: "4rem" }}>
            Send a message to get started.
          </p>
        )}
        {messages.map((msg: OHUIMessage) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: "0.5rem",
          borderTop: "1px solid #eee",
          paddingTop: "0.75rem",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming}
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            border: "1px solid #ccc",
            borderRadius: 6,
            fontSize: "0.95rem",
            outline: "none",
          }}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: 6,
              border: "1px solid #e55",
              background: "#fee",
              color: "#c33",
              cursor: "pointer",
              fontSize: "0.95rem",
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: 6,
              border: "none",
              background: input.trim() ? "#333" : "#ccc",
              color: "#fff",
              cursor: input.trim() ? "pointer" : "default",
              fontSize: "0.95rem",
            }}
          >
            Send
          </button>
        )}
      </form>
    </>
  );
}
