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
          height: "100dvh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
          OpenHarness Demo
        </h1>
        <ChatView />
      </main>
    </OpenHarnessProvider>
  );
}
