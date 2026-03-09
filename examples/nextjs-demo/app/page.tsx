"use client";

import { OpenHarnessProvider } from "@openharness/react";
import { ChatView } from "./components/chat-view";

export default function Home() {
  return (
    <OpenHarnessProvider>
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "2rem 1rem",
          // Fill the viewport *including* the padding so children can size correctly
          // (prevents the messages area from forcing the input below the fold).
          boxSizing: "border-box",
          height: "100dvh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem", flex: "0 0 auto" }}>
          OpenHarness Demo
        </h1>
        <ChatView />
      </main>
    </OpenHarnessProvider>
  );
}
