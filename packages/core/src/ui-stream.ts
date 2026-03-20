import type { UIMessageChunk } from "ai";
import type { SessionEvent } from "./session.js";
import type { OHDataTypes, OHMetadata } from "./types/ui-message.js";

type OHChunk = UIMessageChunk<OHMetadata, OHDataTypes>;

/**
 * Maps a stream of SessionEvents into a ReadableStream of AI SDK 5
 * UIMessageChunks. Handles text/reasoning part lifecycle (start/end),
 * tool mapping, and OH-specific data parts for subagents, compaction,
 * retry, and turn lifecycle.
 */
export function sessionEventsToUIStream(
  events: AsyncIterable<SessionEvent>,
  options?: { signal?: AbortSignal },
): ReadableStream<OHChunk> {
  return new ReadableStream<OHChunk>({
    async start(controller) {
      let partCounter = 0;
      const nextId = () => `oh-${++partCounter}`;

      // Track active text/reasoning part IDs for start/end lifecycle
      let textPartId: string | null = null;
      let reasoningPartId: string | null = null;

      // Track subagent start times and names for duration calculation and done/error events
      const subagentStartTimes = new Map<string, number>();
      const subagentNames = new Map<string, string>();
      const backgroundTaskIds = new Set<string>();

      const enqueue = (chunk: OHChunk) => controller.enqueue(chunk);

      const endTextPart = () => {
        if (textPartId) {
          enqueue({ type: "text-end", id: textPartId });
          textPartId = null;
        }
      };

      const endReasoningPart = () => {
        if (reasoningPartId) {
          enqueue({ type: "reasoning-end", id: reasoningPartId });
          reasoningPartId = null;
        }
      };

      // Emit stream start
      enqueue({ type: "start" } as OHChunk);

      try {
        for await (const event of events) {
          if (options?.signal?.aborted) {
            enqueue({ type: "abort", reason: "aborted" } as OHChunk);
            break;
          }

          switch (event.type) {
            // ── Text ──────────────────────────────────────────────
            case "text.delta": {
              if (!textPartId) {
                endReasoningPart();
                textPartId = nextId();
                enqueue({ type: "text-start", id: textPartId });
              }
              enqueue({ type: "text-delta", id: textPartId, delta: event.text });
              break;
            }

            case "text.done": {
              endTextPart();
              break;
            }

            // ── Reasoning ─────────────────────────────────────────
            case "reasoning.delta": {
              if (!reasoningPartId) {
                endTextPart();
                reasoningPartId = nextId();
                enqueue({ type: "reasoning-start", id: reasoningPartId });
              }
              enqueue({
                type: "reasoning-delta",
                id: reasoningPartId,
                delta: event.text,
              });
              break;
            }

            case "reasoning.done": {
              endReasoningPart();
              break;
            }

            // ── Tools ─────────────────────────────────────────────
            case "tool.start": {
              endTextPart();
              endReasoningPart();

              // Emit tool-input-start + tool-input-available (OH has full input at start)
              enqueue({
                type: "tool-input-start",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
              });
              enqueue({
                type: "tool-input-available",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input: event.input,
              });

              // If this is a task tool (subagent), emit subagent start data part
              if (event.toolName === "task") {
                const input = event.input as {
                  agent?: string;
                  prompt?: string;
                  background?: boolean;
                };
                if (input.agent) {
                  subagentStartTimes.set(event.toolCallId, Date.now());
                  subagentNames.set(event.toolCallId, input.agent);
                  if (input.background) {
                    backgroundTaskIds.add(event.toolCallId);
                  }
                  enqueue({
                    type: "data-oh:subagent.start",
                    data: {
                      agentName: input.agent,
                      task: input.prompt ?? "",
                      path: [input.agent],
                    },
                  });
                }
              }
              break;
            }

            case "tool.done": {
              enqueue({
                type: "tool-output-available",
                toolCallId: event.toolCallId,
                output: event.output,
              });

              // If this is a task tool (subagent), emit subagent done data part
              // Skip for background spawns — the agent is still running
              if (event.toolName === "task" && !backgroundTaskIds.has(event.toolCallId)) {
                const startTime = subagentStartTimes.get(event.toolCallId);
                const durationMs = startTime ? Date.now() - startTime : 0;
                const agentName = subagentNames.get(event.toolCallId) ?? "unknown";
                subagentStartTimes.delete(event.toolCallId);
                subagentNames.delete(event.toolCallId);
                enqueue({
                  type: "data-oh:subagent.done",
                  data: {
                    agentName,
                    durationMs,
                    path: [agentName],
                  },
                });
              } else if (event.toolName === "task") {
                // Clean up tracking for background spawns
                subagentStartTimes.delete(event.toolCallId);
                subagentNames.delete(event.toolCallId);
                backgroundTaskIds.delete(event.toolCallId);
              }
              break;
            }

            case "tool.error": {
              enqueue({
                type: "tool-output-error",
                toolCallId: event.toolCallId,
                errorText: event.error,
              });

              // If this is a task tool (subagent), emit subagent error data part
              if (event.toolName === "task") {
                const agentName = subagentNames.get(event.toolCallId) ?? "unknown";
                subagentStartTimes.delete(event.toolCallId);
                subagentNames.delete(event.toolCallId);
                backgroundTaskIds.delete(event.toolCallId);
                enqueue({
                  type: "data-oh:subagent.error",
                  data: {
                    agentName,
                    error: event.error,
                    path: [agentName],
                  },
                });
              }
              break;
            }

            // ── Steps ─────────────────────────────────────────────
            case "step.start": {
              endTextPart();
              endReasoningPart();
              enqueue({ type: "start-step" } as OHChunk);
              break;
            }

            case "step.done": {
              endTextPart();
              endReasoningPart();
              enqueue({ type: "finish-step" } as OHChunk);
              break;
            }

            // ── Done ──────────────────────────────────────────────
            case "done": {
              endTextPart();
              endReasoningPart();
              const finishReason =
                event.result === "complete"
                  ? "stop"
                  : event.result === "max_steps"
                    ? "tool-calls"
                    : event.result === "error"
                      ? "error"
                      : "unknown";
              enqueue({ type: "finish", finishReason } as OHChunk);
              break;
            }

            // ── Error ─────────────────────────────────────────────
            case "error": {
              enqueue({
                type: "error",
                errorText: event.error.message,
              } as OHChunk);
              break;
            }

            // ── Session lifecycle → OH data parts ─────────────────
            case "turn.start": {
              enqueue({
                type: "data-oh:turn.start",
                data: { turnIndex: event.turnNumber },
              });
              break;
            }

            case "turn.done": {
              enqueue({
                type: "data-oh:turn.done",
                data: {
                  turnIndex: event.turnNumber,
                  durationMs: 0, // not tracked by session currently
                },
              });
              break;
            }

            case "compaction.start": {
              enqueue({
                type: "data-oh:session.compacting",
                data: {},
              });
              enqueue({
                type: "data-oh:compaction.start",
                data: {},
              });
              break;
            }

            case "compaction.done": {
              enqueue({
                type: "data-oh:compaction.done",
                data: { messagesRemoved: 0 },
              });
              break;
            }

            case "compaction.pruned": {
              enqueue({
                type: "data-oh:compaction.done",
                data: { messagesRemoved: event.messagesRemoved },
              });
              break;
            }

            case "retry": {
              enqueue({
                type: "data-oh:retry",
                data: {
                  attempt: event.attempt,
                  reason: event.error.message,
                  delayMs: event.delayMs,
                },
              });
              break;
            }

            // compaction.summary — no UI-facing chunk needed
            case "compaction.summary":
              break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue({ type: "error", errorText: message } as OHChunk);
      }

      controller.close();
    },
  });
}
