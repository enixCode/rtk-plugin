---
description: Show RTK token savings dashboard
---

The RTK binary is installed under `~/.claude/plugins/data/rtk-plugin*/rtk/`, named `rtk` on Linux/macOS and `rtk.exe` on Windows. The exact parent folder depends on whether the plugin was installed from the marketplace (`rtk-plugin`) or run locally with `--plugin-dir` (`rtk-plugin-inline`).

Detect the platform, locate the binary, run `<binary> gain` via the Bash tool, and show the user the output verbatim — no commentary.

If no binary is found, tell the user RTK is not installed yet and to restart Claude Code so the SessionStart hook downloads it.
