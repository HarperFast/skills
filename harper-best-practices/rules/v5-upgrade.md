---
name: v5-upgrade
description: >-
  Breaking changes and recommended updates when migrating a Harper application
  to v5.
metadata:
  mode: generate
  sources:
    - release-notes/v5-lincoln/v5-migration.md
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: 5ee6407370219136
---

# v5 Upgrade: Breaking Changes and Migration Guide

Instructions for the agent to apply when migrating a Harper application to v5, covering all breaking changes and required code updates.

## When to Use

Apply this rule when upgrading an existing Harper application to v5, when encountering runtime errors related to renamed packages, changed APIs, or security restrictions introduced in v5, or when reviewing application code for v5 compatibility before deployment.

## How It Works

1. **Update the package import from `harperdb` to `harper`**: All application code must import from `harper` instead of `harperdb`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable `allowInstallScripts` if packages require install scripts**: Harper v5 uses `--ignore-scripts` by default when installing packages. If your application requires installation scripts (e.g., to install additional binaries), set the `allowInstallScripts` option when deploying.

3. **Update `Table.get` usage — return value is now a frozen record object**: `Table.get` now returns a plain record object, not a table class instance. The record is frozen; you cannot mutate it directly.
   - Replace `wasLoadedFromSource()` with `target.loadedFromSource`:

     ```javascript
     // Old — remove this pattern:
     const record = await Table.get(id);
     if (record.wasLoadedFromSource()) { ... }

     // New — use loadedFromSource on the target:
     const target = new RequestTarget();
     target.id = id;
     const record = await Table.get(target);
     if (target.loadedFromSource) {
       // record was loaded from origin (not cache)
     }
     ```

   - Replace in-place mutation with object spread, since records are frozen:

     ```javascript
     // Old — throws in v5:
     const record = await Table.get(id);
     record.property = 'changed';

     // New — copy instead of mutate:
     let record = await Table.get(id);
     record = { ...record, property: 'changed' };
     ```

   - `getUpdatedTime` and `getExpiresAt` methods remain available on the record object.

4. **Update transaction and context handling**: Harper v5 uses asynchronous context tracking. `Table.get` and other table calls now automatically inherit the current transaction context. Code that previously omitted context to bypass a transaction will no longer work as expected. Use `getContext` (imported from `harper`) to access and commit the current transaction explicitly when you need to see updated data.

   ```javascript
   import { setTimeout as delay } from 'node:timers/promises';
   import { getContext, transaction } from 'harper';

   class MyResource {
   	static async get(target) {
   		// Commit the current transaction to read latest data:
   		await getContext().transaction.commit();
   		// Optionally wrap each poll in a new transaction:
   		while ((await transaction(() => Table.get(target))).status !== 'ready') {
   			await delay(100);
   		}
   		return Table.get(target);
   	}
   }
   ```

5. **Register allowed spawn commands via `allowedSpawnCommands`**: Any use of `spawn`, `exec`, or `execFile` from `node:child_process` must reference executables listed in `applications.allowedSpawnCommands` in `harperdb-config.yaml`. Provide a `name` property in the options argument to ensure only a single named process is started across threads.

6. **Replace `blob.save()` with `saveBeforeCommit`**: The `blob.save()` method has been removed. Use the `saveBeforeCommit` flag in the options passed to the `Blob` constructor instead.

7. **Configure the `moduleLoader` and `lockdown` settings**: Harper v5 loads application modules through Node.js's VM module API. Control this behavior in `harperdb-config.yaml` under the `applications` key.

   | Setting            | Default              | Options                                             |
   | ------------------ | -------------------- | --------------------------------------------------- |
   | `moduleLoader`     | `vm-current-context` | `vm-current-context`, `vm`, `native`, `compartment` |
   | `lockdown`         | `freeze-after-load`  | `freeze-after-load`, `freeze`, `ses`, `none`        |
   | `dependencyLoader` | `auto`               | `auto`, `app`, `native`                             |
   | `allowedDirectory` | `app`                | `app`, `any`                                        |
   - Use `moduleLoader: native` to disable the VM loader entirely and restore pre-v5 behavior (application-specific context such as tagged logging and per-app `config` will not be available).
   - Use `lockdown: none` as a temporary workaround if a dependency modifies intrinsic prototypes at runtime and throws a `TypeError`.

## Examples

### Full `harperdb-config.yaml` `applications` block

```yaml
applications:
  lockdown: freeze-after-load
  moduleLoader: vm-current-context
  dependencyLoader: auto
  allowedDirectory: app
  allowedSpawnCommands:
    - npm
    - node
```

### Restricting allowed built-in modules

```yaml
applications:
  allowedBuiltinModules:
    - fs
    - path
    - http
```

### Disabling the VM loader for package compatibility

```yaml
applications:
  moduleLoader: native
```

### Accessing context and committing a transaction

```javascript
import { getContext } from 'harper';

await getContext().transaction.commit();
```

## Notes

- The `lockdown: freeze-after-load` default freezes `Object`, `Array`, `Promise`, `Map`, `Set`, and other intrinsics after all application code loads. Any code or dependency that mutates intrinsic prototypes after startup will throw a `TypeError`.
- Under `lockdown: ses`, the constrained `fetch` (https-only) is applied only in `vm` mode. In `vm-current-context` and `native` modes, application code uses the standard global `fetch`.
- In production, `allowedDirectory: app` prevents loading modules from outside the application's own directory tree. Set `allowedDirectory: any` only if your application legitimately requires it.
- `dependencyLoader: native` is a narrower alternative to `moduleLoader: native` — it uses native loading only for npm packages while keeping the VM loader for first-party application source files.
- Access Harper functions and APIs through the `harper` package rather than through global variables. Use `getContext` from `harper` to access request context without passing it explicitly through every call.
