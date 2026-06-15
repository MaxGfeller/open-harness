import { useMemo } from "react";
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
export function useTodos(): UseTodosResult {
  const { todoState } = useOHContext();

  return useMemo(() => {
    const total = todoState.todos.length;
    const pending = todoState.todos.filter((todo) => todo.status === "pending").length;
    const inProgress = todoState.todos.filter((todo) => todo.status === "in_progress").length;
    const completed = todoState.todos.filter((todo) => todo.status === "completed").length;
    const cancelled = todoState.todos.filter((todo) => todo.status === "cancelled").length;
    const activeTodo =
      todoState.todos.find((todo) => todo.status === "in_progress") ??
      todoState.todos.find((todo) => todo.status === "pending");

    return {
      ...todoState,
      total,
      pending,
      inProgress,
      completed,
      cancelled,
      hasTodos: total > 0,
      isComplete: total > 0 && completed + cancelled === total,
      activeTodo,
    };
  }, [todoState]);
}
