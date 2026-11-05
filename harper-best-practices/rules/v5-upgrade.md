---
name: v5-upgrade
description: >-
  Breaking changes and recommended updates when migrating a Harper application
  to v5.
metadata:
  mode: generate
  sources:
    - release-notes/v5-lincoln/v5-migration.md
  sourceCommit: 62139d5475bb9993c3aa6bc8d23420ea7610f739
  inputHash: 141693224b082d1c
---

# v5 Upgrade: Breaking Changes and Migration Guide

Instructions for the agent to apply when migrating a Harper application to v5, covering all breaking changes and required code updates.

## When to Use

Apply this rule when upgrading an existing Harper application from v4 to v5, when encountering runtime errors related to module loading, transactions, record access, or process spawning after a v5 upgrade, or when scaffolding new v5-compatible application code.

## How It Works

1. **Update the package import**: Replace all imports from `'harperdb'` with `from 'harper'`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable install scripts if needed**: Harper v5 runs `npm install` with `--ignore-scripts` by default. If your application requires install scripts (e.g., to install native binaries), set `allowInstallScripts` in your deployment options.

3. **Update `Table.get` usage**: `Table.get` now returns a plain frozen record object, not a table class instance. The `wasLoadedFromSource()` method no longer exists on the returned record. Use a `RequestTarget` and check `loadedFromSource` on the target instead.

   ```javascript
   // Before (v4):
   const record = await Table.get(id);
   if (record.wasLoadedFromSource()) {
   	// record was loaded from origin (not cache)
   }
   ```

   ```javascript
   // After (v5):
   const target = new RequestTarget();
   target.id = id;
   const record = await Table.get(target);
   if (target.loadedFromSource) {
   	// record was loaded from origin (not cache)
   }
   ```

   The record objects still expose `getUpdatedTime` and `getExpiresAt` methods.

4. **Handle frozen records**: Records returned by `Table.get` are frozen — you cannot mutate them directly. Spread into a new object instead.

   ```javascript
   // Before (v4):
   const record = await Table.get(id);
   record.property = 'changed';
   ```

   ```javascript
   // After (v5):
   let record = await Table.get(id);
   record = { ...record, property: 'changed' };
   ```

5. **Update transaction and context usage**: Harper v5 uses asynchronous context tracking. `Table.get` and other table calls now automatically inherit the current transaction. If your code previously omitted context to bypass a transaction and read the latest data, that workaround no longer works. Explicitly commit the transaction and/or wrap reads in a new transaction using `getContext` and `transaction` from `'harper'`.

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

6. **Register allowed spawn commands**: Spawning child processes via `node:child_process` is now restricted. Only executables listed in `applications.allowedSpawnCommands` in `harper-config.yaml` may be spawned. Additionally, `spawn`, `execFile`, and `fork` require a `name` property in the `options` argument to prevent process multiplication across threads. `exec` is not usable through the substituted module, and `execSync` always throws.

   ```yaml
   applications:
     allowedSpawnCommands:
       - npm
       - node
   ```

7. **Replace `blob.save()`**: The `blob.save()` method has been removed. Use the `saveBeforeCommit` flag in the options passed to the `Blob` constructor instead.

8. **Configure the module loader**: Harper v5 loads application modules through Node.js's VM module API. The default mode is `vm-current-context`, which shares JavaScript intrinsics (`Object`, `Array`, `Promise`, etc.) with Harper to avoid `instanceof` and identity-check failures across the application/Harper boundary.

   ```yaml
   applications:
     lockdown: seal-after-load
     moduleLoader: vm-current-context # vm-current-context (default) | vm | native | compartment
     dependencyLoader: auto # auto (default) | app | native
     allowedDirectory: app # app (default) | any
   ```

   - Use `vm` only if you need separate per-application intrinsics.
   - Use `native` to restore pre-v5 behavior (standard `import()`), but note that application-specific context (tagged `logger`, per-app `config`) will not be available.
   - Use `dependencyLoader: native` to apply native loading only to npm packages while keeping the VM loader for first-party source files.

9. **Configure `lockdown`**: The default `lockdown: seal-after-load` seals intrinsic prototypes (`Object`, `Array`, `Promise`, `Map`, `Set`, and others) after all components load, blocking prototype pollution. Before v5.4.0 the default was `freeze-after-load`, which froze the intrinsics instead. If a dependency mutates an intrinsic prototype at runtime and throws a `TypeError`, set `lockdown: none` as a temporary workaround.

   ```yaml
   applications:
     lockdown: seal-after-load
   ```

   An in-place upgrade from v4 retains the existing config file, which has no `lockdown` value — Harper will not lock intrinsics until you explicitly add the key.

10. **Check `allowedDirectory` in production**: In production, `allowedDirectory: app` is the default, restricting module loading to the application's own directory tree. If your application loads modules from outside its directory, set `allowedDirectory: any`. This restriction does not apply in dev mode.

11. **Update response objects**: If a REST method returns an object with a `headers` property, Harper v5 will use it as the response headers. Ensure any object with a `headers` property returned from a REST method is intentional.

12. **Use `getContext` instead of passing context explicitly**: Context no longer needs to be threaded through every call. Access it via `getContext` exported from `'harper'`. Prefer `static` methods on Resources/Tables for endpoints and access request information from the `target` argument or via `getContext`.

## Examples

### Full `harper-config.yaml` module loading block

```yaml
applications:
  lockdown: seal-after-load
  moduleLoader: vm-current-context
  dependencyLoader: auto
  allowedDirectory: app
  allowedSpawnCommands:
    - npm
    - node
```

### Disabling the VM loader entirely

```yaml
applications:
  moduleLoader: native
```

### Checking `loadedFromSource` and using `getContext`

```javascript
import { getContext, transaction } from 'harper';

const target = new RequestTarget();
target.id = id;
const record = await Table.get(target);
if (target.loadedFromSource) {
	// record was loaded from origin (not cache)
}
```

### Spreading a frozen record

```javascript
let record = await Table.get(id);
record = { ...record, property: 'changed' };
```

## Notes

- The `logger` exported from `'harper'` is tagged with the application name when using the VM module loader. It is not available with `moduleLoader: native`.
- `instanceof` checks for values crossing the application/Harper boundary will fail when using `moduleLoader: vm` (separate intrinsics). Use `moduleLoader: vm-current-context` (the default) to avoid this.
- `import()` behavior depends on the selected `moduleLoader`. With `native`, it behaves as standard Node.js `import()` with no application context.
- The `exec` function from `node:child_process` is not usable through the substituted module in v5; `execSync` always throws.
- Record objects returned by `Table.get` expose `getUpdatedTime` and `getExpiresAt` even though they are frozen plain objects.
