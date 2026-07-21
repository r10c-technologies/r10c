## Summary

<!-- What changed and why. 1-3 bullets. -->

-

## Type of change

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] refactor — no behavior change
- [ ] perf — performance improvement
- [ ] docs — documentation only
- [ ] test — adding/updating tests
- [ ] chore/build/ci — tooling, deps, pipeline

## Affected projects

<!-- pnpm nx show projects --affected --base=origin/main --head=HEAD -->

-

## Test plan

<!-- How this was verified. Commands run, manual steps, screenshots if UI. -->

- [ ] `pnpm nx affected -t lint,build,test --base=origin/main`
- [ ] Manually verified in the app (if UI-facing)

## Checklist

- [ ] Conventional commit messages with Nx project scope (`type(scope): summary`)
- [ ] `docs/` and root `CLAUDE.md` updated if this changes architecture, commands, or conventions
- [ ] No `--no-verify` / skipped hooks used to get here
- [ ] No secrets or `.env`-style values committed

## Related issues

<!-- Closes #123 / Refs #123 -->
