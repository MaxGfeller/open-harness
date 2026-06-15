import { tool } from "ai";
import { z } from "zod";
import {
  InMemoryTodoStore,
  TODO_PRIORITIES,
  TODO_STATUSES,
  type TodoItem,
  type TodoStore,
  type TodoUpdate,
} from "../todos.js";

const TODO_WRITE_DESCRIPTION = `Create and maintain a structured task list for the current coding session.

Use proactively for non-trivial, multi-step work, when the user gives multiple tasks, or when progress tracking helps keep the work organized.

Rules:
- Keep items specific and actionable.
- Preserve user-provided commands verbatim.
- Mark exactly one item in_progress while actively working.
- Mark completed only after the work and any required verification are done.
- Use cancelled for work that is no longer needed.
- Skip this tool for single-step or purely informational requests.`;

const TodoItemInput = z.object({
  id: z.string().optional().describe("Optional stable ID for this todo item"),
  content: z.string().min(1).describe("Brief, actionable description of the task"),
  status: z.enum(TODO_STATUSES).describe("Current status of the task"),
  priority: z
    .enum(TODO_PRIORITIES)
    .optional()
    .default("medium")
    .describe("Priority level of the task"),
});

const TodoWriteInput = z.object({
  todos: z.array(TodoItemInput).describe("The complete updated todo list, in display order"),
});

const TodoReadInput = z.object({});

export interface CreateTodoToolsOptions {
  /** Stable session key for todo persistence. Defaults to "default" for simple single-session usage. */
  sessionId?: string;
  /** Pluggable persistence. Defaults to an in-memory store scoped to this tool factory call. */
  store?: TodoStore;
  /** Called after a successful write. Useful for app-specific event buses or logs. */
  onUpdate?: (update: TodoUpdate) => void | Promise<void>;
}

export function createTodoTools(options?: CreateTodoToolsOptions) {
  const sessionId = options?.sessionId ?? "default";
  const store = options?.store ?? new InMemoryTodoStore();

  const todowrite = tool({
    description: TODO_WRITE_DESCRIPTION,
    inputSchema: TodoWriteInput,
    execute: async ({ todos }) => {
      const normalized: TodoItem[] = todos.map((todo) => ({
        ...todo,
        priority: todo.priority ?? "medium",
      }));

      await store.save(sessionId, normalized);
      await options?.onUpdate?.({ sessionId, todos: normalized });

      return { sessionId, todos: normalized };
    },
  });

  const todoread = tool({
    description:
      "Read the current todo list for this coding session. Use this if session history may be incomplete or after compaction/resume.",
    inputSchema: TodoReadInput,
    execute: async () => {
      const todos = (await store.load(sessionId)) ?? [];
      return { sessionId, todos };
    },
  });

  return { todowrite, todoread };
}
