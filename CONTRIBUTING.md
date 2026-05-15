# Contributing

Thanks for the interest — but a quick honest note before you spend time on a PR.

This is a personal project. It exists because I wanted RTK wired into my own Claude Code sessions, and shipping it as a plugin was the cleanest way to keep it reproducible across machines. I maintain it based on what I actually hit while using it day-to-day.

What that means in practice:

- **Pull requests are not actively solicited.** I won't merge new verticals, refactors, or feature additions unless they match something I was already planning. Sending a PR is a bet that I'll like it — that bet is mostly unfavorable. Please open an Issue first to discuss.
- **Bug reports are welcome.** Open an Issue with: your OS, Node version, the exact command Claude tried to run, and what you expected vs what happened. Logs from `~/.claude/plugins/data/rtk-plugin/rtk/.bootstrap.log` help.
- **Security reports** — please don't open a public Issue. Reach out to `enixCode` on GitHub privately.
- **Forking is encouraged.** If you want to take this in a different direction, fork it. The MIT license makes that easy.

If you do open a PR anyway, follow these:

1. `bash bin/dispatch.sh < event.json` to smoke-test with a fixture.
2. New routes must follow the `applies(cmd)` / `rewrite(cmd)` contract — see `MakeQuietRoute` in [`bin/dispatch.mjs`](bin/dispatch.mjs).
3. Add a smoke case to [`.github/workflows/validate.yml`](.github/workflows/validate.yml).

## Local hook setup (maintainer note)

The repo ships a `pre-push` hook that refuses to push a `vX.Y.Z` tag whose version doesn't match `.claude-plugin/plugin.json`. To activate it once on your machine:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push  # unix only
```

I appreciate you reading this far.
