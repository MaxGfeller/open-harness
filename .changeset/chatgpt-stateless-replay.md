---
"@openharness/provider-chatgpt": patch
---

Fix multi-step tool calls by forcing stateless Responses replay before the OpenAI SDK serializes request history, so tool results are sent with their matching function calls.
