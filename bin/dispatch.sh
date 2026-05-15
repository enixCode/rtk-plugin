#!/usr/bin/env bash
# Thin wrapper around dispatch.mjs.
# If node is missing, exit 0 silently so Claude Code does not log a hook error
# in the transcript on every Bash tool call. The cost is just no compression
# until the user installs node.
command -v node >/dev/null 2>&1 || exit 0
exec node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch.mjs"
