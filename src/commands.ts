import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { USER_DIR } from "./config.js";

// Custom slash commands: Markdown files in ~/.pretzel-porter/commands/. A file
// `review.md` becomes `/review` — its body is a prompt template sent to the
// model. `$ARGS` is replaced with whatever the operator typed after the
// command (or, if absent, the args are appended). An optional HTML comment on
// the first line provides the /help description.

const CMD_DIR = join(USER_DIR, "commands");

export interface CustomCommand {
  name: string;
  description: string;
  template: string;
}

/** Load every custom command from ~/.pretzel-porter/commands/. */
export function loadCustomCommands(): Map<string, CustomCommand> {
  const commands = new Map<string, CustomCommand>();
  if (!existsSync(CMD_DIR)) return commands;
  let files: string[];
  try {
    files = readdirSync(CMD_DIR);
  } catch {
    return commands;
  }
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".md")) continue;
    const name = file.slice(0, -3).toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(name)) continue;
    try {
      const raw = readFileSync(join(CMD_DIR, file), "utf8");
      const descMatch = raw.match(/^<!--\s*([\s\S]*?)\s*-->/);
      commands.set(name, {
        name,
        description: descMatch?.[1]?.replace(/\s+/g, " ").trim() || `custom command (${file})`,
        template: raw,
      });
    } catch {
      // skip unreadable command files
    }
  }
  return commands;
}

/** Expand a command template with the operator's argument string. */
export function expandCommand(cmd: CustomCommand, args: string): string {
  // Drop a leading description comment from the body.
  let body = cmd.template.replace(/^<!--[\s\S]*?-->\s*/, "");
  if (body.includes("$ARGS")) {
    body = body.split("$ARGS").join(args);
  } else if (args) {
    body = `${body.trimEnd()}\n\n${args}`;
  }
  return body.trim();
}
