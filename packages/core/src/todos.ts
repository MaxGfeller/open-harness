export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_PRIORITIES = ["high", "medium", "low"] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export interface TodoItem {
  id?: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export interface TodoUpdate {
  sessionId: string;
  todos: TodoItem[];
}

export interface TodoStore {
  load(sessionId: string): Promise<TodoItem[] | undefined>;
  save(sessionId: string, todos: TodoItem[]): Promise<void>;
  delete?(sessionId: string): Promise<void>;
}

export class InMemoryTodoStore implements TodoStore {
  private entries = new Map<string, TodoItem[]>();

  async load(sessionId: string): Promise<TodoItem[] | undefined> {
    const todos = this.entries.get(sessionId);
    return todos ? structuredClone(todos) : undefined;
  }

  async save(sessionId: string, todos: TodoItem[]): Promise<void> {
    this.entries.set(sessionId, structuredClone(todos));
  }

  async delete(sessionId: string): Promise<void> {
    this.entries.delete(sessionId);
  }
}

export function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && TODO_STATUSES.includes(value as TodoStatus);
}

export function isTodoPriority(value: unknown): value is TodoPriority {
  return typeof value === "string" && TODO_PRIORITIES.includes(value as TodoPriority);
}

export function isTodoItem(value: unknown): value is TodoItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.id === undefined || typeof item.id === "string") &&
    typeof item.content === "string" &&
    isTodoStatus(item.status) &&
    isTodoPriority(item.priority)
  );
}

export function parseTodoUpdate(output: unknown): TodoUpdate | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const data = output as Record<string, unknown>;
  if (!Array.isArray(data.todos)) return undefined;
  if (!data.todos.every(isTodoItem)) return undefined;

  return {
    sessionId: typeof data.sessionId === "string" ? data.sessionId : "default",
    todos: structuredClone(data.todos),
  };
}
