---
name: v5-upgrade
description: >-
  Breaking changes and recommended updates when migrating a Harper application
  to v5.
metadata:
  mode: generate
  sources:
    - release-notes/v5-lincoln/v5-migration.md
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: 66ca7a9e265d006e
---

# v5 Upgrade: Breaking Changes and Migration Guide

Instructions for the agent to follow when migrating a Harper application to v5, covering all breaking changes and required code updates.

## When to Use

Apply this rule when upgrading an existing Harper application from v4 to v5, when encountering runtime errors after upgrading, or when reviewing application code for v5 compatibility. Every breaking change listed here must be addressed before the application will behave correctly under v5.

## How It Works

1. **Update the package import**: Replace all imports from `'harperdb'` with `from 'harper'`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable install scripts if needed**: Harper v5 runs `npm install` with `--ignore-scripts` by default. If your application requires install scripts (e.g., to compile native binaries), set `allowInstallScripts` in your deployment options.

3. **Update `Table.get` usage**: `Table.get` now returns a plain frozen record object, not a table class instance. The `wasLoadedFromSource()` method no longer exists on the returned object. Replace it with `loadedFromSource` on the `RequestTarget`:

   ```javascript
   // Before
   const record = await Table.get(id);
   if (record.wasLoadedFromSource()) {
   	// record was loaded from origin (not cache)
   }
   ```

   ```javascript
   // After
   import { getContext } from 'harper';
   const target = new RequestTarget();
   target.id = id;
   const record = await Table.get(target);
   if (target.loadedFromSource) {
   	// record was loaded from origin (not cache)
   }
   ```

   The record objects do have `getUpdatedTime` and `getExpiresAt` methods available.

4. **Handle frozen records**: The record object returned by `Table.get` is frozen — you cannot mutate it directly. Copy it before modifying:

   ```javascript
   // Before
   const record = await Table.get(id);
   record.property = 'changed';
   ```

   ```javascript
   // After
   let record = await Table.get(id);
   record = { ...record, property: 'changed' };
   ```

5. **Register allowed spawn commands via `allowedSpawnCommands`**: `spawn` and `execFile` may only launch executables listed in `applications.allowedSpawnCommands` in `harper-config.yaml`. Only the first token of the command is matched. `exec` is not usable through the substituted module, and `execSync` always throws.

   ```yaml
   applications:
     allowedSpawnCommands:
       - npm
       - node
   ```

   Additionally, `spawn`, `execFile`, and `fork` now require a `name` property in the `options` argument to prevent process multiplication across threads.

6. **Update transaction and context usage**: Harper v5 uses asynchronous context tracking. `Table.get` and other calls now automatically inherit the current transaction. Code that previously omitted context to bypass a transaction will no longer work as expected. Explicitly commit the transaction or wrap calls in a new transaction to read updated data:

   ```javascript
   import { setTimeout as delay } from 'node:timers/promises';
   import { getContext, transaction } from 'harper';

   class MyResource {
   	static async get(target) {
   		await getContext().transaction.commit();
   		while ((await transaction(() => Table.get(target))).status !== 'ready') {
   			await delay(100);
   		}
   		return Table.get(target);
   	}
   }
   ```

   Use `getContext` (exported from `'harper'`) to access the current transaction anywhere without passing context explicitly.

7. **Replace `blob.save()`**: The `blob.save()` method has been removed. Use the `saveBeforeCommit` flag in the options passed to the `Blob` constructor instead.

8. **Handle response `headers`**: If you return an object from a REST method with a `headers` property, Harper v5 will use it as the response headers. Ensure any object you return that incidentally has a `headers` property is intentional.

9. **Configure the module loader**: Harper v5 loads application modules through Node.js's VM module API. Control this with the `moduleLoader` setting:

   | Value                | Behavior                                         |
   | -------------------- | ------------------------------------------------ |
   | `vm-current-context` | Default. Shares intrinsics with Harper.          |
   | `vm`                 | Separate context and intrinsics per application. |
   | `native`             | Standard `import()`, no application context.     |
   | `compartment`        | SES Compartments; advanced and heavier.          |

   The default (`vm-current-context`) avoids `instanceof` failures for values crossing the application/Harper boundary. Choose `vm` only if you need separate per-application intrinsics. Use `native` if the VM loader causes compatibility problems you cannot otherwise resolve.

   To disable the VM loader entirely and restore pre-v5 behavior:

   ```yaml
   applications:
     moduleLoader: native
   ```

   Note: `logger` and per-app `config` are not available in `native` mode.

   If the goal is only to fix package compatibility while keeping application context for first-party code, `dependencyLoader: native` is a narrower option — it uses native loading only for npm packages while keeping the VM loader for application source files.

10. **Handle intrinsic `lockdown`**: The default `lockdown` mode (`freeze-after-load`) freezes JavaScript intrinsics (`Object`, `Array`, `Promise`, `Map`, `Set`, etc.) after all application code loads. Any code or dependency that modifies intrinsic prototypes at runtime will throw a `TypeError`. If a dependency requires a temporary workaround, set:

    ```yaml
    applications:
      lockdown: none
    ```

11. **Check `allowedDirectory` in production**: In production, applications can only load modules from within their own directory tree (`allowedDirectory: app`). If your application loads files from outside its directory, set:

    ```yaml
    applications:
      allowedDirectory: any
    ```

## Examples

### Full `harper-config.yaml` module loading block

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

### Updated import and context access

```javascript
import { tables, getContext, transaction } from 'harper';
```

### Checking `loadedFromSource` after `Table.get`

```javascript
const target = new RequestTarget();
target.id = id;
const record = await Table.get(target);
if (target.loadedFromSource) {
	// record was loaded from origin (not cache)
}
```

### Copying a frozen record before mutation

```javascript
let record = await Table.get(id);
record = { ...record, property: 'changed' };
```

## Notes

- The `logger` exported from `'harper'` is tagged with the application name when using the VM module loader. It is not available in `native` mode.
- `instanceof` checks for values crossing the application/Harper boundary will fail when using `moduleLoader: vm` (separate intrinsics). Use `vm-current-context` (the default) to avoid this.
- `import()` behavior depends on the `moduleLoader` setting. In `native` mode, standard Node.js `import()` is used with no application context.
- Automatic context tracking simplifies code but requires explicit `commit()` or new `transaction()` calls when you need to observe data written within the same transaction.
- Use `getContext` from `'harper'` rather than passing context manually through every call — this is the recommended pattern in v5.
