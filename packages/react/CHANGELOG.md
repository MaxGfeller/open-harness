# @openharness/react

## 0.2.6

### Patch Changes

- 7120ad0: Fix publish configuration for all packages. Add `publishConfig.access: "public"` so scoped packages can be published to npm, and switch internal workspace dependencies to `workspace:^` for correct version ranges in published tarballs.
- Updated dependencies [7120ad0]
  - @openharness/core@0.5.3
