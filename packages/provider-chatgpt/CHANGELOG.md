# @openharness/provider-chatgpt

## 0.1.2

### Patch Changes

- d541e3d: Fix multi-step tool calls by forcing stateless Responses replay before the OpenAI SDK serializes request history, so tool results are sent with their matching function calls.

## 0.1.1

### Patch Changes

- 80178c0: Add the experimental ChatGPT/Codex OAuth provider package for using ChatGPT subscription-backed Codex models through the AI SDK.
