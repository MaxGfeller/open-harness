"use client";

import type { UseSubagentStatusResult, SessionState } from "@openharness/react";

interface StatusBarProps {
  subagent: UseSubagentStatusResult;
  session: SessionState;
  isStreaming: boolean;
}

export function StatusBar({ subagent, session, isStreaming }: StatusBarProps) {
  const hasStatus =
    isStreaming ||
    subagent.hasActiveSubagents ||
    session.isCompacting ||
    session.isRetrying;

  if (!hasStatus) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        marginBottom: "0.75rem",
        fontSize: "0.8rem",
      }}
    >
      {isStreaming && <Pill color="#3b82f6">Streaming...</Pill>}

      {subagent.activeSubagents.map((a) => (
        <Pill key={a.name} color="#8b5cf6">
          {a.name}: {a.task}
        </Pill>
      ))}

      {session.isCompacting && (
        <Pill color="#f59e0b">Compacting history...</Pill>
      )}

      {session.isRetrying && (
        <Pill color="#ef4444">
          Retrying (attempt {session.retryAttempt})
          {session.retryReason && `: ${session.retryReason}`}
        </Pill>
      )}
    </div>
  );
}

function Pill({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.2rem 0.6rem",
        borderRadius: 999,
        background: `${color}15`,
        color,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          animation: "pulse 1.5s infinite",
        }}
      />
      {children}
    </span>
  );
}
