# Validation And Open Questions

## Required automated gate

Run in each final lane:

```powershell
bun run typecheck
bun test
bun run check
bun run build
bun run test:package
bun run knip
```

The stable lane must pass with the legacy `{ id, tui }` export. The v2 lane must pass with the v2 `Plugin.define` export and its own smoke assertion.

## Real-host matrix

### Standard OpenCode / `latest`

- Global plugin installation.
- Local plugin installation.
- Plugin restart and cache refresh.
- Sidebar and prompt footer rendering.
- Missing credentials and provider errors.
- Stale cached usage after a failed refresh.
- Multiple enabled providers.
- Disposal while a request is in flight.

### OpenCode v2 / `next`

- Install `oc-usage-limits-plugin@next` through the actual v2 CLI.
- Confirm the `./tui` export is loaded by the local TUI process.
- Confirm sidebar visibility only where `sidebar.content` is rendered.
- Confirm prompt footer behavior for normal mode, shell mode, no session, and active session.
- Confirm v2 theme colors render without legacy field casts.
- Confirm session message lookup selects the latest provider.
- Confirm hot reload does not leave old polling or requests alive.
- Confirm remote-server use follows v2's local TUI plugin requirements.

## Security regression checks

- Auth values remain redacted.
- Provider errors do not include response bodies or credentials.
- HTTP response size limits remain enforced.
- Aborted requests do not continue after cleanup.
- CLI output and environment values are not logged or rendered.

## Open questions requiring an explicit answer

1. Which exact upstream v2 commit or published `@opencode-ai/plugin` version is the supported target?
2. Is the v2 target branch named `v2`, `v2-migration`, or a project branch in this repository?
3. Which prompt slot is preferred: `prompt.footer` or `prompt.footer.status`?
4. Should `CompactStatusLine` finally be registered at `home.footer`, or remain unused?
5. Does `npm stage publish` accept and preserve `--tag next` with the repository's OIDC setup?
6. Should preview releases create GitHub prereleases, or npm publications only?
7. Should stable pending changesets be released before v2 branching, or carried into the stable baseline unchanged?
8. Will v2's host-supplied OpenTUI/Solid versions satisfy the current exact peer dependencies?
9. When v2 stabilizes, should `2.0.0` move `latest`, and will `1.x` continue receiving fixes?

## Stop conditions

Pause implementation and ask for a decision if:

- The v2 branch has no stable/pinned plugin API package to compile against.
- The upstream slot API differs from the researched contract.
- The CLI cannot install a package spec using `@next`.
- Stable and v2 package exports cannot coexist under the same `./tui` path.
- The publish mechanism cannot apply `next` without risking `latest`.
