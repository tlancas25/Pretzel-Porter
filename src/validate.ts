import type { ToolSchema } from "./types.js";

// Tool-call argument validation. A weak local model regularly emits malformed
// tool calls — a missing field, a string where a number belongs, an enum value
// it invented. Left unchecked, the tool fails deep inside `run` with a vague
// error. This layer checks the model's arguments against the tool's JSON-Schema
// parameters *before* the call runs and produces a precise, actionable list of
// problems, so the model can self-correct on its next step.

/** A subset of JSON Schema — what tool parameter descriptors actually use. */
interface PropSchema {
  type?: string;
  enum?: unknown[];
  items?: PropSchema & { properties?: Record<string, unknown>; required?: string[] };
}

/** Cap on reported problems, so a badly-formed array can't flood the model. */
const MAX_PROBLEMS = 8;

/**
 * Validate `args` against a tool's parameter schema. Returns a list of
 * human-readable problems; an empty list means the arguments are acceptable.
 */
export function validateArgs(schema: ToolSchema, args: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const params = schema.parameters;
  const props = (params.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(params.required) ? params.required : [];

  // 1. Every required property must be present and non-null.
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      problems.push(`missing required property "${key}"`);
    }
  }

  // 2. Every supplied argument must match its declared type / enum. Unknown
  //    properties are left alone — an extra field never breaks a tool.
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    const desc = props[key];
    if (!desc || typeof desc !== "object") continue;
    checkValue(`"${key}"`, value, desc as PropSchema, problems);
    if (problems.length >= MAX_PROBLEMS) break;
  }

  return problems.slice(0, MAX_PROBLEMS);
}

/** Check one value against its descriptor; one level of array-item checking. */
function checkValue(label: string, value: unknown, p: PropSchema, problems: string[]): void {
  if (typeof p.type === "string" && !matchesType(value, p.type)) {
    problems.push(`${label} must be ${article(p.type)} ${p.type}, got ${jsonType(value)}`);
    return; // a wrong type makes further checks meaningless
  }
  if (Array.isArray(p.enum) && p.enum.length > 0 && !p.enum.includes(value)) {
    problems.push(`${label} must be one of: ${p.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (p.type === "array" && Array.isArray(value) && p.items && typeof p.items === "object") {
    const items = p.items;
    for (let i = 0; i < value.length && problems.length < MAX_PROBLEMS; i++) {
      const el = value[i];
      const itemLabel = `${label}[${i}]`;
      if (typeof items.type === "string" && !matchesType(el, items.type)) {
        problems.push(`${itemLabel} must be ${article(items.type)} ${items.type}, got ${jsonType(el)}`);
        continue;
      }
      if (items.type === "object" && el && typeof el === "object" && !Array.isArray(el)) {
        const itemReq = Array.isArray(items.required) ? items.required : [];
        for (const rk of itemReq) {
          if ((el as Record<string, unknown>)[rk] === undefined) {
            problems.push(`${itemLabel} is missing required property "${rk}"`);
          }
        }
      }
    }
  }
}

/** Does `value` satisfy a JSON-Schema `type`? Unknown types never fail. */
function matchesType(value: unknown, declared: string): boolean {
  switch (declared) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/** The JSON-ish type name of a value, for error messages. */
function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
