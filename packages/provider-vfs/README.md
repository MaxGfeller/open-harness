# @openharness/provider-vfs

Virtual filesystem provider for [@openharness/core](../core). Gives your agents sandboxed, in-memory, or persistent file access instead of hitting the real filesystem.

Built on [@platformatic/vfs](https://github.com/platformatic/vfs) (a userland shim for the upcoming `node:vfs`). When Node.js ships native VFS support, the provider will use it automatically — no code changes needed.

## Install

```bash
npm install @openharness/provider-vfs @platformatic/vfs
```

Requires Node.js >= 22.

## Usage

```typescript
import { createFsTools } from "@openharness/core";
import { VfsFsProvider } from "@openharness/provider-vfs";

// In-memory VFS (default) — fully ephemeral, no disk access
const fsTools = createFsTools(new VfsFsProvider());
```

### Backends

```typescript
import { MemoryProvider, SqliteProvider, RealFSProvider } from "@platformatic/vfs";

// SQLite-backed — persistent across restarts
const fsTools = createFsTools(new VfsFsProvider({
  provider: new SqliteProvider("/path/to/db.sqlite"),
}));

// Sandboxed real FS — real files, but the agent can't escape the root
const fsTools = createFsTools(new VfsFsProvider({
  provider: new RealFSProvider("/safe/workspace"),
}));
```

### Pre-configured VFS

If you need full control (overlay mode, custom mount point, etc.), create the VFS yourself:

```typescript
import { create, MemoryProvider } from "@platformatic/vfs";

const vfs = create(new MemoryProvider(), { overlay: true, virtualCwd: true });
vfs.mount("/workspace");

const fsTools = createFsTools(new VfsFsProvider({ vfs }));
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `vfs` | — | Pre-created `VirtualFileSystem` instance. Skips auto-creation. |
| `provider` | `MemoryProvider` | VFS backend (`MemoryProvider`, `SqliteProvider`, `RealFSProvider`). |
| `vfsOptions` | `{ moduleHooks: false, virtualCwd: true }` | Options passed to `create()`. |
| `mountPoint` | `"/workspace"` | VFS mount point. |
| `maxFileSize` | `10 MB` | Reject reads for files larger than this. |

## License

MIT
