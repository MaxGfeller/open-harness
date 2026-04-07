---
name: release-local
description: Run the local maintainer release flow for this Changesets-based pnpm monorepo.
disable-model-invocation: true
---

Run the release workflow from `RELEASING.md`.

Guardrails:

- Only run this on `main` unless the user explicitly wants a dry run elsewhere.
- Require a clean worktree before versioning or publishing.
- Ask for confirmation before creating the release commit.
- Ask for confirmation again before starting `pnpm release:publish`, because it publishes to npm, pushes the branch and tags to GitHub, and may require npm OTP entry.

Workflow:

1. Run `pnpm release:status` and confirm there are pending changesets.
2. Run `pnpm version-packages`.
3. Review the generated version bumps and changelog entries with the user.
4. Commit the release files with `Release packages` unless the user requests a different message.
5. Run `pnpm release:publish`.
6. Confirm that npm publish succeeded and that GitHub Releases were created or updated for the tags on `HEAD`.
7. If npm publish succeeded but GitHub release creation failed, rerun `pnpm release:github` after fixing the blocker.

If publish fails because of npm auth, OTP, or missing release notes, stop, report the exact blocker, and do not keep mutating the repo.
