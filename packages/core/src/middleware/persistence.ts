import type { Middleware } from "../runner.js";
import type { SessionStore } from "../session.js";

export interface PersistenceConfig {
  store: SessionStore;
  sessionId: string;
}

/**
 * Auto-saves messages on `done` events.
 * Passes all events through unchanged.
 */
export function withPersistence(config: PersistenceConfig): Middleware {
  return (runner) =>
    async function* (history, input, options) {
      for await (const event of runner(history, input, options)) {
        yield event;
        if (event.type === "done") {
          await config.store.save(config.sessionId, event.messages);
        }
      }
    };
}
