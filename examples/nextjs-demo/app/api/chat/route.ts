import { openai } from "@ai-sdk/openai";
import { Agent, Session } from "@openharness/core";
import { readFile, listFiles, grep } from "@openharness/core/tools/fs";
import { bash } from "@openharness/core/tools/bash";

// ── Agent setup ─────────────────────────────────────────────────────

const explore = new Agent({
  name: "explore",
  description: "Read-only codebase exploration. Searches, reads files, and understands code.",
  systemPrompt:
    "You are a codebase exploration agent with read-only filesystem access. " +
    "Be concise but thorough in your findings.",
  model: openai("gpt-4o-mini"),
  tools: { readFile, listFiles, grep },
  maxSteps: 15,
  instructions: false,
});

const agent = new Agent({
  name: "assistant",
  systemPrompt:
    "You are a helpful coding assistant. You can read, write, and modify files, " +
    "run shell commands, and explore the codebase using the explore subagent. " +
    "Be concise and direct in your responses.",
  model: openai("gpt-4o-mini"),
  tools: { readFile, listFiles, grep, bash },
  maxSteps: 20,
  subagents: [explore],
  instructions: false,
});

// ── Session store (in-memory, per-conversation) ─────────────────────

const sessions = new Map<string, Session>();

function getOrCreateSession(conversationId?: string): Session {
  const id = conversationId ?? crypto.randomUUID();
  let session = sessions.get(id);
  if (!session) {
    session = new Session({
      agent,
      sessionId: id,
      contextWindow: 128_000,
    });
    sessions.set(id, session);
  }
  return session;
}

// ── Route handler ───────────────────────────────────────────────────

export async function POST(req: Request) {
  const { message, conversationId } = await req.json();
  const session = getOrCreateSession(conversationId);
  return session.toResponse(message);
}
