import type { ModelMessage } from "ai";
import type { AgentEvent, TokenUsage } from "../agent.js";
import type { Middleware } from "../runner.js";

/**
 * Maintains a turn counter (persists across calls).
 * Yields `turn.start` before inner events, `turn.done` after.
 */
export function withTurnTracking(): Middleware {
  let turnCount = 0;

  return (runner) =>
    async function* (
      history: ModelMessage[],
      input: string | ModelMessage[],
      options?: { signal?: AbortSignal },
    ): AsyncGenerator<AgentEvent> {
      turnCount++;
      const turnNumber = turnCount;

      yield { type: "turn.start", turnNumber } as any;

      let turnUsage: TokenUsage = {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      };

      for await (const event of runner(history, input, options)) {
        if (event.type === "done") {
          turnUsage = event.totalUsage;
        }
        yield event;
      }

      yield { type: "turn.done", turnNumber, usage: turnUsage } as any;
    };
}
