# rtk-plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-plugin-orange)](https://code.claude.com/docs/en/plugins)

Transparent token compression for Claude Code. Wraps [RTK](https://github.com/rtk-ai/rtk) with a lazy binary download so every supported `Bash` tool call returns 60–90% fewer tokens, automatically.

## Why

Every shell command Claude runs ends up in your context window. `git status` in a busy repo can easily cost 800 tokens. `pnpm install` output? Multiply. Across a long session you burn through your context (and your wallet) on noise that the model doesn't actually need to read line-by-line.

RTK already solves this — it compresses tool output to keep only what matters. This plugin wires RTK into Claude Code so you don't have to think about it. Install, restart, observe.

## Install

```text
/plugin marketplace add enixCode/plugins
/plugin install rtk-plugin@enix
```

Restart Claude Code. On first launch the `SessionStart` hook downloads the pinned RTK release into `${CLAUDE_PLUGIN_DATA}/rtk/` (about 5 MB, ~3 s on a normal connection) and initializes it globally — no manual `rtk init -g` required. Subsequent sessions reuse the cached copy.

## Observe the savings (example)

After a few sessions, type `/rtk-plugin:gain` in any Claude Code chat:

```
RTK Token Savings (Global Scope)
════════════════════════════════════════════════════════════
Total commands:    127
Input tokens:      48.2K
Output tokens:     19.7K
Tokens saved:      28.5K (59.1%)
```

The dashboard shows total commands routed through the compressor, input vs output tokens, total savings, and a per-command breakdown so you can see which programs save you the most. Data lives in a local SQLite database (`%LOCALAPPDATA%\rtk\history.db` on Windows, `~/.local/share/rtk/` on Linux/macOS). Telemetry is **off by default** — inspect with `rtk config`.

## What gets rewritten

| Input command            | Rewritten to                              | Why                                   |
| ------------------------ | ----------------------------------------- | ------------------------------------- |
| `git status`             | `"<plugin-data>/rtk/rtk" git status`      | RTK collapses the long status output  |
| `cargo test`             | `"<plugin-data>/rtk/rtk" cargo test`      | RTK reformats test runner output      |
| `pnpm install`           | `"<plugin-data>/rtk/rtk" pnpm install`    | RTK trims dependency lists            |
| `git status \| head`     | _passthrough_                             | Pipes/chains skipped (safe by default)|
| `whoami`                 | _passthrough_                             | Program not in compression list       |
| `rtk git status`         | _passthrough_                             | Already wrapped, no double-prefix     |

The complete list of programs RTK compresses is defined in [`bin/dispatch.mjs`](bin/dispatch.mjs) under `RtkRoute.TOOLS`. The dispatcher passes through anything containing shell features (`|`, `&&`, `$()`, …) so your existing scripts stay untouched.

## How it works

```
SessionStart  ─►  node scripts/bootstrap-rtk.mjs
                  downloads RTK into ${CLAUDE_PLUGIN_DATA}/rtk/
                  then runs `rtk init -g` (silent, once per session)

PreToolUse    ─►  node bin/dispatch.mjs
on Bash           parses the hook event, routes to RtkRoute,
                  emits hookSpecificOutput JSON
```

Hooks use exec form (`command: "node"` + `args: [...]`) so the script is spawned directly without a shell. The `.sh` wrappers in `bin/` and `scripts/` exist for reference and direct shell invocation only; they are not wired into `hooks.json`.

## Requirements

| Component                | Required ? | Fallback if missing                                |
| ------------------------ | ---------- | -------------------------------------------------- |
| `bash`                   | Yes        | None — install Git for Windows on native Windows   |
| Node.js ≥ 18             | Yes        | Silent passthrough (no compression, no error)      |
| `tar` (Linux/macOS) or PowerShell `Expand-Archive` (Windows, built-in) | Yes for first run | Bootstrap fails silently, plugin falls back to passthrough |
| RTK binary               | Auto-downloaded by `SessionStart` | Silent passthrough until download succeeds |

Claude Code's own setup [recommends Git for Windows](https://code.claude.com/docs/en/setup#set-up-on-windows) on native Windows, so the `bash` requirement aligns with their default.

## Troubleshooting

**My commands look normal in the transcript, no `rtk` prefix.**
Check `node --version` reports `v18.0.0` or higher. The wrapper exits silently when Node is missing.

**"Could not spawn hook" errors on every command (Windows).**
You're on native Windows without [Git for Windows](https://git-scm.com/downloads/win). Install it, restart Claude Code.

**First session is slow.**
The `SessionStart` hook downloads RTK (~5 MB). Subsequent sessions are instant. Check `~/.claude/plugins/data/rtk-plugin/rtk/.bootstrap.log` if it fails repeatedly.

**I want to disable the plugin for one session.**
`/plugin disable rtk-plugin@enix`. To uninstall completely, `/plugin uninstall rtk-plugin@enix`.

## Adding a vertical route

If you want to compress a tool RTK doesn't cover (e.g. Helm, Postgres `EXPLAIN`), follow the pattern of `MakeQuietRoute` / `MvnQuietRoute` in [`bin/dispatch.mjs`](bin/dispatch.mjs) — a class with `applies(cmd)` and `rewrite(cmd)`, then push `new YourRoute(...)` into the `Dispatcher`'s `routes` array.

## Local development

```bash
# Run the plugin from this repo without installing it.
claude --plugin-dir ./

# Smoke-test the dispatcher locally.
echo '{"tool_input":{"command":"git status"}}' | bash bin/dispatch.sh
```

To test the install flow with a local marketplace, drop a `marketplace.json` into a gitignored `.marketplace-local/` and `/plugin marketplace add ./.marketplace-local`.

## Versioning

The pinned RTK release lives in `REQUIRED_RTK_VERSION` at the top of [`scripts/bootstrap-rtk.mjs`](scripts/bootstrap-rtk.mjs). A daily workflow ([`upstream-watch.yml`](.github/workflows/upstream-watch.yml)) checks `rtk-ai/rtk` for new releases and opens a PR that bumps both the pin and the plugin's patch version.

Plugin releases are cut by pushing a `vX.Y.Z` tag that matches `plugin.json`. The [`release.yml`](.github/workflows/release.yml) workflow creates the GitHub Release with an auto-generated changelog.

> **Note on distribution.** Claude Code's marketplace doesn't download release assets — it `git clone`s this repository at the requested ref. The GitHub Release is metadata: a changelog and a discoverable version pointer. The actual code users run is whatever is in the repo at the tag commit. This is why the `vX.Y.Z` tag and `plugin.json` version must stay in sync (enforced by both the [`release.yml`](.github/workflows/release.yml) assertion and the local [`.githooks/pre-push`](.githooks/pre-push) hook).

## Project structure

```
.claude-plugin/plugin.json    Plugin manifest
hooks/hooks.json              SessionStart + PreToolUse(Bash) wiring
bin/dispatch.sh               Node-detecting wrapper for the PreToolUse hook
bin/dispatch.mjs              Hook logic: Dispatcher + RtkRoute (+ example routes)
scripts/bootstrap-rtk.sh      Node-detecting wrapper for the SessionStart hook
scripts/bootstrap-rtk.mjs     Lazy RTK downloader
commands/gain.md              Slash command (`/rtk-plugin:gain`) for the savings dashboard
.github/workflows/            CI: validate, upstream-watch, release
```

## Credits

Built on top of [`rtk-ai/rtk`](https://github.com/rtk-ai/rtk) by [Tarek Ould-Cheikh](https://github.com/rtk-ai). All the heavy lifting — the actual compression algorithms, the per-tool filters, the SQLite tracking — happens there. This plugin is just glue code that wires RTK into Claude Code's hook system. Thanks to the RTK team for shipping a binary that does one thing well.

## Contributing

This is a personal project maintained based on my own usage. I'm not actively soliciting external contributions — see [CONTRIBUTING.md](CONTRIBUTING.md) for context. Bug reports via Issues are still welcome.

## License

[MIT](LICENSE). The software is provided **"as is", without warranty of any kind** — see the LICENSE file for the full disclaimer. Token savings will vary by usage; the numbers in this README reflect typical sessions, not a guarantee.
