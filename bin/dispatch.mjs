#!/usr/bin/env node
// PreToolUse(Bash) hook: rewrite simple shell commands to a compressed equivalent.
// Strategy: delegate the supported tools to the lazy-downloaded RTK binary.
// Anything else passthrough and maybe custom compression in future.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

class HookEvent {
  constructor(payload) { this.payload = payload ?? {}; }

  static fromStdin() {
    let payload = {};
    try { payload = JSON.parse(readFileSync(0, "utf8")); } catch {}
    return new HookEvent(payload);
  }

  get command() {
    const c = this.payload?.tool_input?.command;
    return typeof c === "string" ? c : "";
  }
}

class ParsedCommand {
  // Strip benign IO redirections (2>&1, 2>/dev/null, >file, >>file, <input) before
  // checking for shell features. Claude Code appends `2>&1` to most Bash calls, so
  // matching it as a shell feature meant the dispatcher passed through nearly
  // everything and no compression ever happened.
  static STRIP_REDIR = /\s\d?>>?(?:&\d|\S+)|\s<\S+/g;
  static SHELL_FEATURES = /[|&;`$()]|\|\||&&/;
  static ALREADY_RTK = /^["']?(?:\S*[\\\/])?rtk(?:\.exe)?["']?\s/i;

  constructor(raw) {
    this.raw = raw;
    const [first = "", ...rest] = raw.trim().split(/\s+/);
    this.program = first.split("/").pop();
    this.args = rest;
  }
  get usesShellFeatures() {
    return ParsedCommand.SHELL_FEATURES.test(this.raw.replace(ParsedCommand.STRIP_REDIR, ""));
  }
  get alreadyWrapped() { return ParsedCommand.ALREADY_RTK.test(this.raw); }
}

class HookResponse {
  static passthrough() { process.exit(0); }
  static rewrite(newCommand) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: newCommand },
      },
    }));
    process.exit(0);
  }
}

class RtkRoute {
  static TOOLS = new Set([
    "git", "gh", "ls", "find", "grep", "diff", "cat", "less", "head", "tail",
    "cargo", "go", "pytest", "jest", "vitest", "playwright", "rake", "rspec", "mocha",
    "eslint", "tsc", "prettier", "ruff", "rubocop", "golangci-lint",
    "npm", "npx", "pnpm", "yarn", "pip", "pipx", "poetry", "bundle", "prisma",
    "docker", "kubectl", "helm", "aws", "gcloud", "az",
    "curl", "wget", "jq",
  ]);

  constructor(pluginData) {
    const candidates = pluginData
      ? [join(pluginData, "rtk", "rtk"), join(pluginData, "rtk", "rtk.exe")]
      : [];
    this.binary = candidates.find(existsSync) ?? null;
  }
  applies(cmd) { return RtkRoute.TOOLS.has(cmd.program) && this.binary !== null; }
  rewrite(cmd) { return `"${this.binary}" ${cmd.raw}`; }
}

// ─── EXAMPLE ROUTES ──────────────────────────────────────────────────────────
// Two ready-to-enable routes covering tools RTK does NOT support. They are
// implemented and tested by inspection but not wired into the Dispatcher by
// default. To enable one, add `new ExampleRoute(...)` to the routes array
// below.

// `make` is verbose by default (prints every "Entering directory ..." line).
// `--no-print-directory` cuts that noise without changing any build output.
class MakeQuietRoute {
  applies(cmd) {
    if (cmd.program !== "make") return false;
    return !cmd.args.includes("--no-print-directory");
  }
  rewrite(cmd) { return `make --no-print-directory ${cmd.args.join(" ")}`.trim(); }
}

// `mvn` prints download progress and a banner on every command. `-q` keeps
// only errors + the final BUILD SUCCESS/FAILURE line.
class MvnQuietRoute {
  applies(cmd) {
    if (cmd.program !== "mvn") return false;
    return !cmd.args.includes("-q") && !cmd.args.includes("--quiet");
  }
  rewrite(cmd) { return `mvn -q ${cmd.args.join(" ")}`.trim(); }
}

class Dispatcher {
  constructor(env = process.env) {
    // Active routes. Append example routes here once you've verified them.
    this.routes = [
      new RtkRoute(env.CLAUDE_PLUGIN_DATA ?? ""),
      // new MakeQuietRoute(),
      // new MvnQuietRoute(),
    ];
  }
  handle(event) {
    if (!event.command) HookResponse.passthrough();
    const cmd = new ParsedCommand(event.command);
    if (cmd.usesShellFeatures || cmd.alreadyWrapped) HookResponse.passthrough();
    const route = this.routes.find((r) => r.applies(cmd));
    if (!route) HookResponse.passthrough();
    HookResponse.rewrite(route.rewrite(cmd));
  }
}

new Dispatcher().handle(HookEvent.fromStdin());
