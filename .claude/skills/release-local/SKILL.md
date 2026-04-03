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
- Ask for confirmation again before starting `pnpm release:publish`, because npm auth and OTP may require user interaction.

Workflow:

1. Run `pnpm release:status` and confirm there are pending changesets.
2. Run `pnpm version-packages`.
3. Review the generated version bumps and changelog entries with the user.
4. Commit the release files with `Release packages` unless the user requests a different message.
5. Run `pnpm release:publish`.
6. Remind the user to push the release commit and tags with `git push origin main --follow-tags`.
7. Remind the user that GitHub Releases are generated automatically after the tags reach GitHub.

If publish fails because of npm auth, OTP, or missing release notes, stop, report the exact blocker, and do not keep mutating the repo.
