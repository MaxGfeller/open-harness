import { computed } from "vue";
import { useOHContext, type TodoState } from "../context.js";

export interface UseTodosResult extends TodoState {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  hasTodos: boolean;
  isComplete: boolean;
  activeTodo: TodoState["todos"][number] | undefined;
}

/**
 * Derives the latest todo state from `data-oh:todo.updated` events.
 *
 * Must be used within an `<OpenHarnessProvider>`.
 */
export function useTodos() {
  const { todoState } = useOHContext();

  return computed<UseTodosResult>(() => {
    const total = todoState.value.todos.length;
    const pending = todoState.value.todos.filter((todo) => todo.status === "pending").length;
    const inProgress = todoState.value.todos.filter((todo) => todo.status === "in_progress").length;
    const completed = todoState.value.todos.filter((todo) => todo.status === "completed").length;
    const cancelled = todoState.value.todos.filter((todo) => todo.status === "cancelled").length;
    const activeTodo =
      todoState.value.todos.find((todo) => todo.status === "in_progress") ??
      todoState.value.todos.find((todo) => todo.status === "pending");

    return {
      ...todoState.value,
      total,
      pending,
      inProgress,
      completed,
      cancelled,
      hasTodos: total > 0,
      isComplete: total > 0 && completed + cancelled === total,
      activeTodo,
    };
  });
}
