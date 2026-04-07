---
name: changeset
description: Draft a Changesets file for modified public packages in this repo.
argument-hint: "[extra release context]"
disable-model-invocation: true
---

Create or update a `.changeset/*.md` file for the current branch.

Repo-specific rules:

- Only publishable packages belong in a changeset: `@openharness/core`, `@openharness/react`, `@openharness/vue`, `@openharness/provider-vfs`.
- Ignore `apps/*` and `examples/*` unless they reveal a user-facing package behavior change that should still be described under one of the public packages.
- If the branch only changes docs, examples, or website content, say that no changeset is needed instead of inventing one.
- Prefer the smallest valid bump. Use `major` only for real breaking API or behavior changes.
- Write notes for users, not implementation archaeology. One short paragraph is usually enough.

Workflow:

1. Inspect staged changes first. If nothing is staged, compare the branch against `main`.
2. Identify which public packages changed and choose the bump level for each package.
3. If the bump is ambiguous, or if any package needs a `major` bump, stop and ask for confirmation before writing the file.
4. Write the changeset file in `.changeset/` with frontmatter for the affected packages and a concise note below it.
5. Show the file contents after writing it.

If the user supplied extra context in the command arguments, incorporate it into the summary when it improves the release note.
