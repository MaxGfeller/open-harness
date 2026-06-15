import { describe, expect, it, vi } from "vitest";
import { createTodoTools } from "../../tools/create-todo-tools.js";
import { InMemoryTodoStore } from "../../todos.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper to bypass AI SDK's union return type
async function exec(tool: any, input: any): Promise<any> {
  return tool.execute(input, { toolCallId: "test", messages: [] });
}

describe("createTodoTools", () => {
  it("writes and reads session-scoped todos", async () => {
    const store = new InMemoryTodoStore();
    const tools = createTodoTools({ sessionId: "session-1", store });
    const todos = [
      { content: "Inspect implementation", status: "completed", priority: "high" },
      { content: "Add tests", status: "in_progress", priority: "medium" },
    ];

    await expect(exec(tools.todowrite, { todos })).resolves.toEqual({
      sessionId: "session-1",
      todos,
    });
    await expect(exec(tools.todoread, {})).resolves.toEqual({
      sessionId: "session-1",
      todos,
    });
  });

  it("replaces the todo list and defaults priority to medium", async () => {
    const store = new InMemoryTodoStore();
    const tools = createTodoTools({ sessionId: "session-1", store });

    await exec(tools.todowrite, {
      todos: [{ content: "Old item", status: "pending", priority: "low" }],
    });
    const result = await exec(tools.todowrite, {
      todos: [{ content: "New item", status: "in_progress" }],
    });

    expect(result).toEqual({
      sessionId: "session-1",
      todos: [{ content: "New item", status: "in_progress", priority: "medium" }],
    });
    await expect(store.load("session-1")).resolves.toEqual(result.todos);
  });

  it("calls onUpdate after a successful write", async () => {
    const onUpdate = vi.fn();
    const tools = createTodoTools({ sessionId: "session-1", onUpdate });
    const todos = [{ content: "Ship feature", status: "pending", priority: "high" }];

    await exec(tools.todowrite, { todos });

    expect(onUpdate).toHaveBeenCalledWith({ sessionId: "session-1", todos });
  });
});
