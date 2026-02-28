import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { Agent, type AgentEvent, type TokenUsage } from "./agent.js";

// ── Session Events ──────────────────────────────────────────────────

export type SessionEvent = AgentEvent | SessionLifecycleEvent;

export type SessionLifecycleEvent =
  | { type: "turn.start"; turnNumber: number }
  | { type: "turn.done"; turnNumber: number; usage: TokenUsage }
  | { type: "compaction.start"; reason: "overflow" | "manual"; tokensBefore: number }
  | { type: "compaction.pruned"; tokensRemoved: number; messagesRemoved: number }
  | { type: "compaction.summary"; summary: string }
  | { type: "compaction.done"; tokensBefore: number; tokensAfter: number }
  | { type: "retry"; attempt: number; maxRetries: number; delayMs: number; error: Error };

// ── Compaction ──────────────────────────────────────────────────────

export interface CompactionStrategy {
  compact(context: CompactionContext): Promise<CompactionResult>;
}

export interface CompactionContext {
  messages: ModelMessage[];
  model: LanguageModel;
  systemPrompt: string | undefined;
  totalTokens: number;
  targetTokens: number;
  compactionPrompt?: string;
  signal?: AbortSignal;
}

export interface CompactionResult {
  messages: ModelMessage[];
  summary?: string;
  messagesRemoved: number;
  tokensPruned: number;
}

// ── Persistence ─────────────────────────────────────────────────────

export interface SessionStore {
  load(sessionId: string): Promise<ModelMessage[] | undefined>;
  save(sessionId: string, messages: ModelMessage[]): Promise<void>;
  delete?(sessionId: string): Promise<void>;
}

// ── Retry ───────────────────────────────────────────────────────────

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  isRetryable?: (error: Error) => boolean;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

// ── Hooks ───────────────────────────────────────────────────────────

export interface SessionHooks {
  /** Modify messages before each LLM call. */
  onBeforeSend?: (messages: ModelMessage[]) => ModelMessage[] | Promise<ModelMessage[]>;
  /** Called after each turn completes. */
  onAfterResponse?: (info: TurnInfo) => void | Promise<void>;
  /** Return a custom prompt for the compaction summarizer. */
  onCompaction?: (
    context: CompactionContext,
  ) => string | undefined | Promise<string | undefined>;
  /** Called on errors. Return true to suppress the error. */
  onError?: (error: Error, attempt: number) => boolean | void | Promise<boolean | void>;
}

export interface TurnInfo {
  turnNumber: number;
  messages: ModelMessage[];
  usage: TokenUsage;
}

// ── Compaction check info ───────────────────────────────────────────

export interface CompactionCheckInfo {
  lastInputTokens: number;
  contextWindow: number;
  reservedTokens: number;
  messages: ModelMessage[];
  turnNumber: number;
}

// ── Session Options ─────────────────────────────────────────────────

export interface SessionOptions {
  agent: Agent;

  /** Model context window size in tokens. Required for auto-compaction. */
  contextWindow?: number;

  /** Tokens reserved for output. Default: min(20_000, agent.maxTokens ?? 20_000). */
  reservedTokens?: number;

  /** Enable auto-compaction. Default: true (when contextWindow is set). */
  autoCompact?: boolean;

  /** Custom overflow detection function. */
  shouldCompact?: (info: CompactionCheckInfo) => boolean;

  /** Custom compaction strategy. Default: DefaultCompactionStrategy(). */
  compactionStrategy?: CompactionStrategy;

  /** Retry config for transient API errors. */
  retry?: Partial<RetryConfig>;

  /** Lifecycle hooks. */
  hooks?: SessionHooks;

  /** Pluggable persistence. In-memory only when omitted. */
  sessionStore?: SessionStore;

  /** Session ID. Auto-generated UUID when omitted. */
  sessionId?: string;
}

// ── Default Compaction Strategy ─────────────────────────────────────

const DEFAULT_SUMMARY_PROMPT = `Summarize this conversation for the next agent turn:
1. Goal: What the user is trying to accomplish
2. Instructions: Key directives and constraints mentioned
3. Discoveries: Important findings during the conversation
4. Accomplished: What's been completed, files changed, actions taken
5. Current State: Where things stand, pending work
6. Relevant Context: File paths, code snippets, specific details needed to continue`;

export class DefaultCompactionStrategy implements CompactionStrategy {
  private protectedTokens: number;
  private minPruneSavings: number;
  private summaryModel?: LanguageModel;
  private summaryPrompt?: string;
  private estimateTokens: (messages: ModelMessage[]) => number;

  constructor(options?: {
    /** Estimated tokens to protect at the end of conversation. Default: 40_000. */
    protectedTokens?: number;
    /** Minimum token savings for pruning-only compaction. Default: 20_000. */
    minPruneSavings?: number;
    /** Model to use for summarization. Defaults to the agent's model (from context). */
    summaryModel?: LanguageModel;
    /** Custom summarization prompt. Can also be set via onCompaction hook. */
    summaryPrompt?: string;
    /** Custom token estimator. Default: JSON.stringify(msg).length / 4. */
    estimateTokens?: (messages: ModelMessage[]) => number;
  }) {
    this.protectedTokens = options?.protectedTokens ?? 40_000;
    this.minPruneSavings = options?.minPruneSavings ?? 20_000;
    this.summaryModel = options?.summaryModel;
    this.summaryPrompt = options?.summaryPrompt;
    this.estimateTokens = options?.estimateTokens ?? defaultEstimateTokens;
  }

  async compact(context: CompactionContext): Promise<CompactionResult> {
    // Phase 1: Pruning
    const pruned = pruneToolResults(
      context.messages,
      this.protectedTokens,
      this.minPruneSavings,
      this.estimateTokens,
    );

    if (pruned.tokensSaved >= this.minPruneSavings) {
      return {
        messages: pruned.messages,
        messagesRemoved: 0,
        tokensPruned: pruned.tokensSaved,
      };
    }

    // Phase 2: Summarization
    const model = this.summaryModel ?? context.model;
    const prompt = context.compactionPrompt ?? this.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT;

    const conversationText = context.messages
      .map((m) => `${m.role}: ${JSON.stringify(m.content)}`)
      .join("\n");

    const { text: summary } = await generateText({
      model,
      system: prompt,
      messages: [{ role: "user", content: conversationText }],
      abortSignal: context.signal,
    });

    const summaryMessages: ModelMessage[] = [
      {
        role: "user",
        content: `[Previous conversation summary]\n\n${summary}\n\n[The conversation continues from here]`,
      },
    ];

    return {
      messages: summaryMessages,
      summary,
      messagesRemoved: context.messages.length - 1,
      tokensPruned: this.estimateTokens(context.messages) - this.estimateTokens(summaryMessages),
    };
  }
}

// ── Pruning helpers ─────────────────────────────────────────────────

interface PruneResult {
  messages: ModelMessage[];
  tokensSaved: number;
  messagesModified: number;
}

function estimateMessageTokens(
  msg: ModelMessage,
  estimator: (msgs: ModelMessage[]) => number,
): number {
  return estimator([msg]);
}

function pruneToolResults(
  messages: ModelMessage[],
  protectedTokens: number,
  minSavings: number,
  estimateTokens: (msgs: ModelMessage[]) => number,
): PruneResult {
  const result = structuredClone(messages);
  let accumulated = 0;
  let boundary = result.length;

  // Find protection boundary (walk backward)
  for (let i = result.length - 1; i >= 0; i--) {
    accumulated += estimateMessageTokens(result[i], estimateTokens);
    if (accumulated >= protectedTokens) {
      boundary = i;
      break;
    }
  }

  // Prune tool results before boundary
  let tokensSaved = 0;
  let modified = 0;
  for (let i = 0; i < boundary; i++) {
    if (result[i].role === "tool") {
      const before = estimateMessageTokens(result[i], estimateTokens);
      const content = result[i].content;
      if (Array.isArray(content)) {
        result[i].content = content.map((part: any) =>
          part.type === "tool-result" ? { ...part, result: "[pruned]" } : part,
        );
      }
      const after = estimateMessageTokens(result[i], estimateTokens);
      tokensSaved += before - after;
      modified++;
    }
  }

  if (tokensSaved < minSavings) {
    return { messages, tokensSaved: 0, messagesModified: 0 };
  }

  return { messages: result, tokensSaved, messagesModified: modified };
}

function defaultEstimateTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

// ── Retry helpers ───────────────────────────────────────────────────

function isRetryableError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    /429|500|502|503|504|529/.test(msg) ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("overloaded")
  );
}

function getRetryDelay(attempt: number, config: RetryConfig, error: Error): number {
  const retryAfter = (error as any).headers?.["retry-after"];
  if (retryAfter) return Math.min(parseInt(retryAfter) * 1000, config.maxDelayMs);

  const base = config.initialDelayMs * config.backoffMultiplier ** attempt;
  const jitter = Math.random() * 0.3 * base;
  return Math.min(base + jitter, config.maxDelayMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  };
}

// ── Session ─────────────────────────────────────────────────────────

export class Session {
  readonly agent: Agent;
  readonly sessionId: string;

  /** The conversation messages. Directly readable and replaceable. */
  messages: ModelMessage[] = [];

  private _turns = 0;
  private _totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  private contextWindow?: number;
  private reservedTokens: number;
  private autoCompact: boolean;
  private shouldCompactFn?: (info: CompactionCheckInfo) => boolean;
  private compactionStrategy: CompactionStrategy;
  private retryConfig: RetryConfig;
  private hooks: SessionHooks;
  private sessionStore?: SessionStore;
  private lastInputTokens = 0;

  constructor(options: SessionOptions) {
    this.agent = options.agent;
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.contextWindow = options.contextWindow;
    this.reservedTokens =
      options.reservedTokens ?? Math.min(20_000, options.agent.maxTokens ?? 20_000);
    this.autoCompact = options.autoCompact ?? options.contextWindow !== undefined;
    this.shouldCompactFn = options.shouldCompact;
    this.compactionStrategy =
      options.compactionStrategy ?? new DefaultCompactionStrategy();
    this.retryConfig = { ...DEFAULT_RETRY, ...options.retry };
    this.hooks = options.hooks ?? {};
    this.sessionStore = options.sessionStore;
  }

  get turns(): number {
    return this._turns;
  }

  get totalUsage(): TokenUsage {
    return this._totalUsage;
  }

  /** Load session from store. */
  async load(): Promise<boolean> {
    if (!this.sessionStore) return false;
    const loaded = await this.sessionStore.load(this.sessionId);
    if (loaded) {
      this.messages = loaded;
      return true;
    }
    return false;
  }

  /** Save session to store. */
  async save(): Promise<void> {
    if (!this.sessionStore) return;
    await this.sessionStore.save(this.sessionId, this.messages);
  }

  /** Send a message. Handles compaction + retry automatically. */
  async *send(
    input: string | ModelMessage[],
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<SessionEvent> {
    this._turns++;
    const turnNumber = this._turns;
    yield { type: "turn.start", turnNumber };

    // Auto-compaction check
    if (this.autoCompact && this.contextWindow && this.shouldCompactCheck()) {
      yield* this.compact({ signal: options?.signal });
    }

    // Hook: onBeforeSend
    let effectiveMessages = this.messages;
    if (this.hooks.onBeforeSend) {
      effectiveMessages = await this.hooks.onBeforeSend([...this.messages]);
    }

    const snapshot = [...this.messages];
    const { maxRetries } = this.retryConfig;
    const isRetryable = this.retryConfig.isRetryable ?? isRetryableError;

    let turnUsage: TokenUsage = {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let hasYieldedContent = false;
      let shouldRetry = false;

      try {
        for await (const event of this.agent.run(effectiveMessages, input, {
          signal: options?.signal,
        })) {
          if (event.type === "text.delta" || event.type === "tool.start") {
            hasYieldedContent = true;
          }

          if (event.type === "step.done") {
            this.lastInputTokens = event.usage.inputTokens ?? 0;
          }

          if (
            event.type === "error" &&
            !hasYieldedContent &&
            isRetryable(event.error) &&
            attempt < maxRetries
          ) {
            const delayMs = getRetryDelay(attempt, this.retryConfig, event.error);
            const suppressed = await this.hooks.onError?.(event.error, attempt);
            yield {
              type: "retry",
              attempt,
              maxRetries,
              delayMs,
              error: event.error,
            };
            this.messages = [...snapshot];
            await sleep(delayMs, options?.signal);
            shouldRetry = true;
            break;
          }

          if (event.type === "done") {
            this.messages = event.messages;
            turnUsage = event.totalUsage;
            yield event;
            break;
          }

          yield event;
        }
      } catch (thrown) {
        const error = thrown instanceof Error ? thrown : new Error(String(thrown));
        if (!hasYieldedContent && isRetryable(error) && attempt < maxRetries) {
          const delayMs = getRetryDelay(attempt, this.retryConfig, error);
          await this.hooks.onError?.(error, attempt);
          yield {
            type: "retry",
            attempt,
            maxRetries,
            delayMs,
            error,
          };
          this.messages = [...snapshot];
          await sleep(delayMs, options?.signal);
          continue;
        }
        throw thrown;
      }

      if (shouldRetry) continue;
      break;
    }

    // Hook: onAfterResponse
    if (this.hooks.onAfterResponse) {
      await this.hooks.onAfterResponse({
        turnNumber,
        messages: this.messages,
        usage: turnUsage,
      });
    }

    // Persist
    if (this.sessionStore) {
      await this.sessionStore.save(this.sessionId, this.messages);
    }

    this._totalUsage = addUsage(this._totalUsage, turnUsage);
    yield { type: "turn.done", turnNumber, usage: turnUsage };
  }

  /** Manually trigger compaction. */
  async *compact(
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<SessionLifecycleEvent> {
    const reason = this.shouldCompactCheck() ? "overflow" : "manual";
    const tokensBefore = defaultEstimateTokens(this.messages);
    yield { type: "compaction.start", reason, tokensBefore };

    // Get custom prompt from hook
    const context: CompactionContext = {
      messages: this.messages,
      model: this.agent.model,
      systemPrompt: this.agent.systemPrompt,
      totalTokens: tokensBefore,
      targetTokens: this.contextWindow
        ? this.contextWindow - this.reservedTokens
        : tokensBefore / 2,
      signal: options?.signal,
    };

    if (this.hooks.onCompaction) {
      const customPrompt = await this.hooks.onCompaction(context);
      if (customPrompt) {
        context.compactionPrompt = customPrompt;
      }
    }

    const result = await this.compactionStrategy.compact(context);

    if (result.tokensPruned > 0) {
      yield {
        type: "compaction.pruned",
        tokensRemoved: result.tokensPruned,
        messagesRemoved: result.messagesRemoved,
      };
    }

    if (result.summary) {
      yield { type: "compaction.summary", summary: result.summary };
    }

    this.messages = result.messages;
    const tokensAfter = defaultEstimateTokens(this.messages);
    yield { type: "compaction.done", tokensBefore, tokensAfter };
  }

  private shouldCompactCheck(): boolean {
    if (!this.contextWindow) return false;

    const info: CompactionCheckInfo = {
      lastInputTokens: this.lastInputTokens,
      contextWindow: this.contextWindow,
      reservedTokens: this.reservedTokens,
      messages: this.messages,
      turnNumber: this._turns,
    };

    if (this.shouldCompactFn) {
      return this.shouldCompactFn(info);
    }

    return this.lastInputTokens >= this.contextWindow - this.reservedTokens;
  }
}
