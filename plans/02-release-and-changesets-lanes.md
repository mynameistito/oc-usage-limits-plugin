# Release And Changeset Lanes

## Stable lane: preserve standard OpenCode

Keep `main` on the current legacy API and keep `.github/workflows/release.yml` scoped to `main`. The three existing pending changesets are ordinary stable changes and should not be consumed by the v2 preview branch:

- `calm-goats-usage.md`: OpenCode GO provider, minor.
- `c1aada04.md`: Bun/dependency refresh, patch.
- `88c97f94.md`: partial auth reads and oversized HTTP cancellation, patch.

Release these normally through Changesets if they are intended for the next stable release. Do not manually edit `package.json` versions.

## V2 preview lane

Use a separate branch and workflow, for example:

- Branch trigger: `opencode-v2` only.
- Version line: `2.0.0-next.0`, then incrementing `2.0.0-next.N`.
- npm dist-tag: `next`.
- GitHub release: either explicitly marked prerelease or omitted; never create a normal stable release for a `-next` version.

Use Changesets prerelease mode only on the v2 branch:

```powershell
bunx changeset pre enter next
bun run version
```

Commit the generated `.changeset/pre.json` and version/changelog changes only within the v2 release lane. Exit prerelease mode only during an explicit promotion:

```powershell
bunx changeset pre exit
```

Do not let both branches independently consume the same changeset files. If a change applies to both lanes, create or port separate changesets deliberately.

## Workflow changes to design and test

Create a separate `.github/workflows/release-next.yml` rather than adding branch conditionals to the stable workflow. It should:

1. Trigger only on the v2 branch, with optional `workflow_dispatch` for controlled previews.
2. Install dependencies and run the full verification gate.
3. Run Changesets versioning in prerelease mode.
4. Publish the exact package version with the `next` dist-tag.
5. Never move `latest`.
6. Avoid stable GitHub tag/release assumptions.

The current stable workflow uses `npm stage publish --access public --provenance`. Before reusing it, verify that staged publishing accepts a dist-tag option and that the tag is applied on final publish. If not, use the supported npm OIDC publishing command for prereleases and retain provenance.

The next workflow must keep its idempotency checks, but check the exact package version before publishing. A previously published `2.0.0-next.N` must never be republished.

## Package smoke tests

Make `scripts/test-package.ts` test the selected lane explicitly, or add a v2 smoke script. Stable assertions must continue to require a callable `tui` function. V2 assertions must require a default `{ id: string, setup: function }` object expected by the selected OpenCode package.

The package export remains:

```text
oc-usage-limits-plugin/tui
oc-usage-limits-plugin/schema
```

Do not change package name or export path solely to distinguish v2.

## Documentation changes

Document both installation paths in `README.md`:

```text
opencode plugin oc-usage-limits-plugin -g
opencode plugin oc-usage-limits-plugin@next -g
```

State clearly that `@next` requires OpenCode v2 and is experimental. Include cache troubleshooting for both `@latest` and `@next` and explain that the package cache may retain a prior immutable version.

## Promotion policy

Do not promote automatically. Before v2 promotion, require:

- A pinned upstream v2 API/release.
- Successful real-host testing.
- A decision about `1.x` maintenance.
- A decision that `2.0.0` should move `latest`.
- A final Changeset outside prerelease mode.
