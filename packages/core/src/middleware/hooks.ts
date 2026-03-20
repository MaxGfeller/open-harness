import type { SessionHooks } from "../session.js";
import type { Middleware } from "../runner.js";

/**
 * Applies SessionHooks around the inner runner.
 * - `onBeforeSend`: modifies history before passing to inner runner
 * - `onAfterResponse`: called after the stream completes with a done event
 * - `onError`: can suppress error events (return `true` to swallow)
 */
export function withHooks(hooks: SessionHooks): Middleware {
  return (runner) =>
    async function* (history, input, options) {
      let effectiveHistory = history;
      if (hooks.onBeforeSend) {
        effectiveHistory = await hooks.onBeforeSend([...history]);
      }

      let doneMessages: any[] | undefined;
      let doneUsage: any | undefined;

      for await (const event of runner(effectiveHistory, input, options)) {
        if (event.type === "error" && hooks.onError) {
          const suppressed = await hooks.onError(event.error, 0);
          if (suppressed === true) continue;
        }

        if (event.type === "done") {
          doneMessages = event.messages;
          doneUsage = event.totalUsage;
        }

        yield event;
      }

      if (hooks.onAfterResponse && doneMessages) {
        await hooks.onAfterResponse({
          turnNumber: 0,
          messages: doneMessages,
          usage: doneUsage,
        });
      }
    };
}
