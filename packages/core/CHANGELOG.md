# @openharness/core

## 0.6.2

### Patch Changes

- 015dad0: Update license in README files from ISC to MIT to match the actual project license.

## 0.6.1

### Patch Changes

- 68c2184: Add pagination support to the `listFiles` and `grep` filesystem tools. Both tools now accept optional `offset` and `limit` parameters and automatically paginate large results within the configured byte budget, returning a `status` message with instructions to fetch the next page. The default max output size is lowered from 50 KB to 32 KB.

## 0.6.0

### Minor Changes

- 7ae7ecd: Add subagent sessions, enabling stateful multi-turn conversations with subagents. The `task` tool now supports session modes (`stateless`, `new`, `resume`, `fork`) and a pluggable `SubagentSessionMetadataStore` for tracking session state. A `SubagentCatalog` interface allows lazy, dynamic resolution of subagent definitions. The React and Vue providers surface the `sessionId` on `SubagentInfo` so UIs can track which session a subagent belongs to.

## 0.5.3

### Patch Changes

- 7120ad0: Fix publish configuration for all packages. Add `publishConfig.access: "public"` so scoped packages can be published to npm, and switch internal workspace dependencies to `workspace:^` for correct version ranges in published tarballs.
