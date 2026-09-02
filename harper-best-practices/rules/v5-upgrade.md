---
name: v5-upgrade
description: >-
  Breaking changes and recommended updates when migrating a Harper application
  to v5.
metadata:
  mode: generate
  sources:
    - release-notes/v5-lincoln/v5-migration.md
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: 01c0fafb9afa68a0
---

# v5 Upgrade: Breaking Changes and Migration Guide

Instructions for the agent to apply when migrating a Harper application to v5, covering all breaking changes and required code updates.

## When to Use

Apply this rule when upgrading an existing Harper application to v5, when encountering runtime errors related to renamed packages, changed APIs, or security restrictions after a v5 upgrade, or when scaffolding new v5-compatible application code.

## How It Works

1. **Update the package import from `harperdb` to `harper`**: All application code must import from `harper`, not `harperdb`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable `allowInstallScripts` if packages require install scripts**: Harper v5 uses `--ignore-scripts` by default when installing packages. If a package requires execution of install scripts (e.g., to install native binaries), set the `allowInstallScripts` option when deploying.

3. **Update `Table.get` usage — return value is now a frozen record object**: `Table.get` now returns a plain record object, not a table class instance. The record is frozen; you cannot add or mutate properties directly.
   - Replace direct property mutation:

     ```javascript
     let record = await Table.get(id);
     record = { ...record, property: 'changed' };
     ```

   - Replace `wasLoadedFromSource()` with `loadedFromSource` on the `target` object:

     ```javascript
     const target = new RequestTarget();
     target.id = id;
     const record = await Table.get(target);
     if (target.loadedFromSource) {
     	// record was loaded from origin (not cache)
     }
     ```

   The record objects still expose `getUpdatedTime` and `getExpiresAt` methods.

4. **Update transaction and context handling using `getContext`**: Harper v5 uses asynchronous context tracking. Context and the current transaction are automatically carried to all downstream calls — you no longer pass context explicitly. Import `getContext` and `transaction` from `harper`:

   ```javascript
   import { getContext, transaction } from 'harper';
   ```

   If your code previously omitted context to escape a transaction (e.g., to poll for updated data), explicitly commit the transaction and/or wrap each read in a new `transaction()` call:

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

5. **Register allowed spawn commands via `allowedSpawnCommands`**: `spawn` and `execFile` may only launch executables listed in `applications.allowedSpawnCommands` in `harperdb-config.yaml`. Only the first token of the command is matched. `exec` is not usable through the substituted module; `execSync` always throws.

   ```yaml
   applications:
     allowedSpawnCommands:
       - npm
       - node
   ```

   Additionally, `spawn`, `execFile`, and `fork` now require a `name` property in the `options` argument to prevent process multiplication across threads.

6. **Use `saveBeforeCommit` instead of `blob.save()`**: The `blob.save()` method has been removed. Pass the `saveBeforeCommit` flag in the options to the `Blob` constructor instead.

7. **Handle `headers` on returned response objects**: If you return an object from a REST method with a `headers` property, Harper v5 will use it as the response headers.

8. **Configure the VM module loader and `lockdown` in `harperdb-config.yaml`**: v5 loads application modules through Node.js's VM module API. Control all behavior under the `applications` key:

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

   **`moduleLoader` options:**

   | Value                | Behavior                                                                                                                         |
   | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
   | `vm-current-context` | Default. VM loader in Harper's own context; shares intrinsics with Harper. Best compatibility.                                   |
   | `vm`                 | VM loader in a separate per-application context with its own intrinsics. Stronger isolation but may cause `instanceof` failures. |
   | `native`             | Standard Node.js `import()`. No VM loader; application-specific context (`logger`, `config`) unavailable.                        |
   | `compartment`        | SES Compartment-based loading. For specialized sandboxing only.                                                                  |

   **`lockdown` options:**

   | Value               | Behavior                                                |
   | ------------------- | ------------------------------------------------------- |
   | `freeze-after-load` | Default. Freezes intrinsics after all components load.  |
   | `freeze`            | Freezes intrinsics before loading any application code. |
   | `ses`               | Full SES lockdown via the `ses` package. Strictest.     |
   | `none`              | No lockdown. Use as a temporary workaround only.        |

   To disable the VM loader entirely and restore pre-v5 behavior:

   ```yaml
   applications:
     moduleLoader: native
   ```

## Examples

**Full transaction polling pattern (v5):**

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

**Checking `loadedFromSource` after `Table.get`:**

```javascript
const target = new RequestTarget();
target.id = id;
const record = await Table.get(target);
if (target.loadedFromSource) {
	// record was loaded from origin (not cache)
}
```

**Full `harperdb-config.yaml` `applications` block:**

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

**Restricting allowed built-in modules:**

```yaml
applications:
  allowedBuiltinModules:
    - fs
    - path
    - http
```

## Notes

- Always import Harper APIs from `'harper'`, not from global variables or `'harperdb'`.
- `getContext` is exported from `'harper'` and provides access to the current transaction without passing context explicitly.
- Record objects returned by `Table.get` are frozen — spread into a new object before modifying.
- `loadedFromSource` is a property on the `target` object, replacing the removed `wasLoadedFromSource()` instance method.
- `saveBeforeCommit` replaces the removed `blob.save()` method.
- The `headers` property on a returned REST response object is used as response headers.
- Under `lockdown: ses`, the constrained `fetch` applies only in `vm` mode. In `vm-current-context` and `native` modes, application code uses the standard global `fetch`.
- In production, `allowedDirectory: app` is the default; modules outside the application directory tree will throw. Set `allowedDirectory: any` only if legitimately required.
- `dependencyLoader: native` is a narrower option than `moduleLoader: native` — it uses native loading only for npm packages while keeping the VM loader for first-party application source files.
