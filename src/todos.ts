// In-session task list. The agent maintains this through the todo_write tool
// to plan and track multi-step jobs; the operator can view it with /todos.
// It is intentionally session-scoped — not persisted — since a task list
// belongs to one piece of work, not the whole project.

export type TodoStatus = "pending" | "in_progress" | "done";

export interface Todo {
  content: string;
  status: TodoStatus;
}

let todos: Todo[] = [];

export function setTodos(next: Todo[]): void {
  todos = next;
}

export function getTodos(): Todo[] {
  return todos;
}

/** A plain-text rendering of the list, for the tool result and /todos. */
export function renderTodos(): string {
  if (todos.length === 0) return "(task list is empty)";
  const mark: Record<TodoStatus, string> = {
    pending: "[ ]",
    in_progress: "[~]",
    done: "[x]",
  };
  return todos.map((t) => `${mark[t.status]} ${t.content}`).join("\n");
}
