import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";
import {
  Agent,
  Conversation,
  toRunner,
  apply,
  withTurnTracking,
  withCompaction,
  withRetry,
  withPersistence,
  extractUserInput,
  type SessionStore,
} from "@openharness/core";
import { readFile, listFiles, grep } from "@openharness/core/tools/fs";
import { bash } from "@openharness/core/tools/bash";

// ── Announce tool ──────────────────────────────────────────────────

const announce = tool({
  description:
    "Narrate what you are currently doing or about to do. " +
    "Use this to keep the user informed of your progress. " +
    "The message will be displayed prominently in the chat.",
  inputSchema: z.object({
    message: z.string().describe("A short status message describing what you are doing"),
  }),
  execute: async ({ message }) => message,
});

// ── Agent setup ─────────────────────────────────────────────────────

const explore = new Agent({
  name: "explore",
  description: "Read-only codebase exploration. Searches, reads files, and understands code.",
  systemPrompt:
    "You are a codebase exploration agent with read-only filesystem access. " +
    "Be concise but thorough in your findings.",
  model: openai("gpt-5.2"),
  tools: { readFile, listFiles, grep },
  maxSteps: 15,
  instructions: false,
});

const agent = new Agent({
  name: "assistant",
  systemPrompt:
    "You are a helpful coding assistant. You can read, write, and modify files, " +
    "run shell commands, and explore the codebase using the explore subagent. " +
    "Be concise and direct in your responses.\n\n" +
    "IMPORTANT: Use the `announce` tool frequently to narrate what you are doing. " +
    "Call it before starting a multi-step task, when switching between subtasks, " +
    "and when you have a notable finding. Keep announcements short (one sentence).",
  model: openai("gpt-5.2"),
  tools: { readFile, listFiles, grep, bash, announce },
  maxSteps: 100,
  subagents: [explore],
  instructions: false,
});

// ── In-memory store ─────────────────────────────────────────────────

const messageStore = new Map<string, any[]>();

const store: SessionStore = {
  async load(sessionId) {
    return messageStore.get(sessionId);
  },
  async save(sessionId, messages) {
    messageStore.set(sessionId, messages);
  },
};

// ── Conversation cache (per session) ─────────────────────────────────

const conversations = new Map<string, Conversation>();

function getOrCreateConversation(conversationId?: string): Conversation {
  const id = conversationId ?? crypto.randomUUID();
  let conv = conversations.get(id);
  if (!conv) {
    const runner = apply(
      toRunner(agent),
      withTurnTracking(),
      withCompaction({ contextWindow: 128_000, model: agent.model }),
      withRetry(),
      withPersistence({ store, sessionId: id }),
    );

    conv = new Conversation({ runner, sessionId: id, store });
    conversations.set(id, conv);
  }
  return conv;
}

// ── Route handler ───────────────────────────────────────────────────

export default defineEventHandler(async (event) => {
  const { id, messages } = await readBody(event);
  const conv = getOrCreateConversation(id);

  const input = await extractUserInput(messages);
  return conv.toResponse(input);
});
