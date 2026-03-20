import type { ModelMessage } from "ai";
import type { AgentEvent } from "../agent.js";
import type { Middleware } from "../runner.js";
import type { RetryConfig } from "../session.js";
import { isRetryableError, getRetryDelay, sleep } from "../utils.js";

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

/**
 * Retries the inner runner on transient errors if no content has been yielded yet.
 * Yields `retry` lifecycle events on each retry attempt.
 */
export function withRetry(config?: Partial<RetryConfig>): Middleware {
  const retryConfig: RetryConfig = { ...DEFAULT_RETRY, ...config };

  return (runner) =>
    async function* (
      history: ModelMessage[],
      input: string | ModelMessage[],
      options?: { signal?: AbortSignal },
    ): AsyncGenerator<AgentEvent> {
      const { maxRetries } = retryConfig;
      const isRetryable = retryConfig.isRetryable ?? isRetryableError;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let hasYieldedContent = false;
        let shouldRetry = false;

        try {
          for await (const event of runner(history, input, options)) {
            if (event.type === "text.delta" || event.type === "tool.start") {
              hasYieldedContent = true;
            }

            if (
              event.type === "error" &&
              !hasYieldedContent &&
              isRetryable(event.error) &&
              attempt < maxRetries
            ) {
              const delayMs = getRetryDelay(attempt, retryConfig, event.error);
              yield {
                type: "retry",
                attempt,
                maxRetries,
                delayMs,
                error: event.error,
              } as any;
              await sleep(delayMs, options?.signal);
              shouldRetry = true;
              break;
            }

            if (event.type === "done") {
              yield event;
              break;
            }

            yield event;
          }
        } catch (thrown) {
          const error = thrown instanceof Error ? thrown : new Error(String(thrown));
          if (!hasYieldedContent && isRetryable(error) && attempt < maxRetries) {
            const delayMs = getRetryDelay(attempt, retryConfig, error);
            yield {
              type: "retry",
              attempt,
              maxRetries,
              delayMs,
              error,
            } as any;
            await sleep(delayMs, options?.signal);
            continue;
          }
          throw thrown;
        }

        if (shouldRetry) continue;
        break;
      }
    };
}
