#!/usr/bin/env bash
# Thin wrapper around bootstrap-rtk.mjs.
# Silent passthrough if node is missing — compression simply won't work until
# the user installs node, but we don't pollute the transcript.
command -v node >/dev/null 2>&1 || exit 0
exec node "${CLAUDE_PLUGIN_ROOT}/scripts/bootstrap-rtk.mjs"
