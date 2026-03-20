import type { LanguageModel, ModelMessage } from "ai";
import type { AgentEvent } from "../agent.js";
import type { Middleware } from "../runner.js";
import type {
  CompactionStrategy,
  CompactionContext,
  CompactionCheckInfo,
} from "../session.js";
import { DefaultCompactionStrategy } from "../session.js";
import { defaultEstimateTokens } from "../utils.js";

export interface CompactionConfig {
  contextWindow: number;
  model: LanguageModel;
  systemPrompt?: string;
  reservedTokens?: number;
  shouldCompact?: (info: CompactionCheckInfo) => boolean;
  strategy?: CompactionStrategy;
}

/**
 * Auto-compacts message history when the context window is approaching its limit.
 * Tracks `lastInputTokens` from `step.done` events across calls.
 * Before calling the inner runner: checks if compaction is needed, runs the
 * strategy, yields compaction lifecycle events, and passes the compacted
 * history to the inner runner.
 */
export function withCompaction(config: CompactionConfig): Middleware {
  const reservedTokens = config.reservedTokens ?? 20_000;
  const strategy = config.strategy ?? new DefaultCompactionStrategy();
  let lastInputTokens = 0;

  return (runner) =>
    async function* (
      history: ModelMessage[],
      input: string | ModelMessage[],
      options?: { signal?: AbortSignal },
    ): AsyncGenerator<AgentEvent> {
      let effectiveHistory = history;

      // Check if compaction is needed
      const info: CompactionCheckInfo = {
        lastInputTokens,
        contextWindow: config.contextWindow,
        reservedTokens,
        messages: history,
        turnNumber: 0,
      };

      const needsCompaction = config.shouldCompact
        ? config.shouldCompact(info)
        : lastInputTokens >= config.contextWindow - reservedTokens;

      if (needsCompaction && history.length > 0) {
        const tokensBefore = defaultEstimateTokens(history);
        yield {
          type: "compaction.start",
          reason: "overflow",
          tokensBefore,
        } as any;

        const context: CompactionContext = {
          messages: history,
          model: config.model,
          systemPrompt: config.systemPrompt,
          totalTokens: tokensBefore,
          targetTokens: config.contextWindow - reservedTokens,
          signal: options?.signal,
        };

        const result = await strategy.compact(context);

        if (result.tokensPruned > 0) {
          yield {
            type: "compaction.pruned",
            tokensRemoved: result.tokensPruned,
            messagesRemoved: result.messagesRemoved,
          } as any;
        }

        if (result.summary) {
          yield {
            type: "compaction.summary",
            summary: result.summary,
          } as any;
        }

        effectiveHistory = result.messages;
        const tokensAfter = defaultEstimateTokens(effectiveHistory);
        yield {
          type: "compaction.done",
          tokensBefore,
          tokensAfter,
        } as any;
      }

      // Run inner runner with (possibly compacted) history
      for await (const event of runner(effectiveHistory, input, options)) {
        if (event.type === "step.done") {
          lastInputTokens = event.usage.inputTokens ?? 0;
        }
        yield event;
      }
    };
}
