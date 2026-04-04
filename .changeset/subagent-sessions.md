---
"@openharness/core": minor
"@openharness/react": minor
"@openharness/vue": minor
---

Add subagent sessions, enabling stateful multi-turn conversations with subagents. The `task` tool now supports session modes (`stateless`, `new`, `resume`, `fork`) and a pluggable `SubagentSessionMetadataStore` for tracking session state. A `SubagentCatalog` interface allows lazy, dynamic resolution of subagent definitions. The React and Vue providers surface the `sessionId` on `SubagentInfo` so UIs can track which session a subagent belongs to.
