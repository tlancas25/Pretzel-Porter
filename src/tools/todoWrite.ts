import type { Tool } from "../types.js";
import { setTodos, renderTodos, type Todo, type TodoStatus } from "../todos.js";

const STATUSES: TodoStatus[] = ["pending", "in_progress", "done"];

export const todoWriteTool: Tool = {
  risk: "read",
  schema: {
    name: "todo_write",
    description:
      "Maintain a task list for the current multi-step job. Pass the complete " +
      "list every time — it replaces the previous one. Use it to plan work and " +
      "to track progress: mark a task in_progress when you start it and done " +
      "when it is finished.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The full task list.",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "What the task is." },
              status: { type: "string", enum: STATUSES, description: "Task status." },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
  },
  summarize: (args) => {
    const n = Array.isArray(args.todos) ? args.todos.length : 0;
    return `update task list (${n} item${n === 1 ? "" : "s"})`;
  },
  async run(args) {
    const raw = Array.isArray(args.todos) ? args.todos : [];
    const todos: Todo[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const content = typeof rec.content === "string" ? rec.content.trim() : "";
      if (!content) continue;
      const status = STATUSES.includes(rec.status as TodoStatus)
        ? (rec.status as TodoStatus)
        : "pending";
      todos.push({ content, status });
    }
    setTodos(todos);
    return { ok: true, output: "Task list updated:\n" + renderTodos() };
  },
};
