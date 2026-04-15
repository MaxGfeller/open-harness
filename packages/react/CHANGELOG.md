# @openharness/react

## 1.0.1

### Patch Changes

- 015dad0: Update license in README files from ISC to MIT to match the actual project license.
- Updated dependencies [015dad0]
  - @openharness/core@0.6.2

## 1.0.0

### Minor Changes

- 7ae7ecd: Add subagent sessions, enabling stateful multi-turn conversations with subagents. The `task` tool now supports session modes (`stateless`, `new`, `resume`, `fork`) and a pluggable `SubagentSessionMetadataStore` for tracking session state. A `SubagentCatalog` interface allows lazy, dynamic resolution of subagent definitions. The React and Vue providers surface the `sessionId` on `SubagentInfo` so UIs can track which session a subagent belongs to.

### Patch Changes

- Updated dependencies [7ae7ecd]
  - @openharness/core@0.6.0

## 0.2.6

### Patch Changes

- 7120ad0: Fix publish configuration for all packages. Add `publishConfig.access: "public"` so scoped packages can be published to npm, and switch internal workspace dependencies to `workspace:^` for correct version ranges in published tarballs.
- Updated dependencies [7120ad0]
  - @openharness/core@0.5.3
