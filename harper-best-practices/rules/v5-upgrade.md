---
name: v5-upgrade
description: >-
  Breaking changes and recommended updates when migrating a Harper application
  to v5.
metadata:
  mode: generate
  sources:
    - release-notes/v5-lincoln/v5-migration.md
  sourceCommit: aa74b1cca7f4a511877730268f2fb6e628b50cf9
  inputHash: 01c0fafb9afa68a0
---

# v5 Upgrade: Breaking Changes and Migration Guide

Instructions for the agent to apply all required breaking-change fixes and recommended updates when migrating a Harper application to v5.

## When to Use

Apply this rule whenever upgrading an existing Harper application to v5, encountering v5 runtime errors related to module imports, `Table.get` return values, transaction context, process spawning, or VM module loading. Also apply when configuring `harperdb-config.yaml` for a v5 deployment.

## How It Works

1. **Update the package import from `harperdb` to `harper`**: All application code must import from `harper`, not `harperdb`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable `allowInstallScripts` if packages require install scripts**: Harper v5 uses `--ignore-scripts` by default when installing packages. If your application requires installation scripts (e.g., to install additional binaries), set the `allowInstallScripts` option when deploying.

3. **Update `Table.get` usage — return value is now a plain frozen record object**: `Table.get` no longer returns an instance of the table class. The returned object is frozen and does not have table instance methods.
   - Replace `wasLoadedFromSource()` with `target.loadedFromSource`:

     ```javascript
     // OLD — no longer works
     const record = await Table.get(id);
     if (record.wasLoadedFromSource()) {
     	// record was loaded from origin (not cache)
     }
     ```

     ```javascript
     // NEW
     const target = new RequestTarget(); // note that this is passed in if you are overriding the `get` method
     target.id = id;
     const record = await Table.get(target);
     if (target.loadedFromSource) {
     	// record was loaded from origin (not cache)
     }
     ```

   - The record object still has `getUpdatedTime` and `getExpiresAt` methods available.

   - **Handle frozen records**: The record object is frozen — you cannot add or remove properties directly. Copy and spread instead:

     ```javascript
     // OLD — throws in v5
     const record = await Table.get(id);
     record.property = 'changed';
     ```

     ```javascript
     // NEW
     let record = await Table.get(id);
     record = { ...record, property: 'changed' };
     ```

4. **Update transaction and context handling**: Harper v5 uses asynchronous context tracking. Context and the current transaction are automatically carried to all calls, including `Table.get`. Code that previously omitted context to escape a transaction must now explicitly commit or start a new transaction.
   - Import `getContext` and `transaction` from `harper`:

     ```javascript
     import { getContext, transaction } from 'harper';
     ```

   - Explicitly commit the current transaction before reading updated data:

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

5. **Register allowed spawn commands via `allowedSpawnCommands`**: Any `spawn` or `execFile` call may only launch executables listed in `applications.allowedSpawnCommands` in `harperdb-config.yaml`. The `exec` function is not usable through the substituted module, and `execSync` always throws. The `spawn`, `execFile`, and `fork` functions also require a `name` property in the `options` argument to prevent process multiplication across threads.

6. **Replace `blob.save()` with `saveBeforeCommit`**: The `blob.save()` method has been removed. Use the `saveBeforeCommit` flag in the options passed to the `Blob` constructor instead.

7. **Configure the `moduleLoader` and `lockdown` settings**: Harper v5 loads application modules through Node.js's VM module API. Control all behavior in the `applications` section of `harperdb-config.yaml`:

   ```yaml
   applications:
     lockdown: freeze-after-load # default; see below
     moduleLoader: vm-current-context # vm-current-context (default) | vm | native | compartment
     dependencyLoader: auto # auto (default) | app | native
     allowedDirectory: app # app (default) | any
     allowedSpawnCommands: # see "Spawning new processes" above
       - npm
       - node
     # allowedBuiltinModules: [] # if omitted, all Node.js built-ins are allowed
   ```

   **`moduleLoader` options:**

   | Value                | Behavior                                                                                                                         |
   | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
   | `vm-current-context` | Default. VM loader in Harper's own context; shares intrinsics with Harper for best compatibility.                                |
   | `vm`                 | VM loader in a separate per-application context with its own intrinsics; stronger isolation but can cause `instanceof` failures. |
   | `native`             | Standard Node.js `import()` with no VM loader; application-specific context (tagged logging, per-app `config`) not available.    |
   | `compartment`        | SES Compartment-based loading; for specialized sandboxing only.                                                                  |

   **`lockdown` options:**

   | Value               | Behavior                                                      |
   | ------------------- | ------------------------------------------------------------- |
   | `freeze-after-load` | Default. Freezes intrinsics after all components have loaded. |
   | `freeze`            | Freezes intrinsics before loading any application code.       |
   | `ses`               | Full SES lockdown via the `ses` package; strictest.           |
   | `none`              | No lockdown. Use as a temporary workaround only.              |
   - To disable the VM loader entirely and restore pre-v5 behavior:

     ```yaml
     applications:
       moduleLoader: native
     ```

   - To restrict which Node.js built-ins are accessible:

     ```yaml
     applications:
       allowedBuiltinModules:
         - fs
         - path
         - http
     ```

   - To allow loading modules from outside the application directory:

     ```yaml
     applications:
       allowedDirectory: any
     ```

## Examples

**Full transaction context migration:**

```javascript
import { setTimeout as delay } from 'node:timers/promises';
import { getContext, transaction } from 'harper';

class MyResource {
	static async get(target) {
		// Explicitly commit the transaction to see updated data
		await getContext().transaction.commit();
		// Start a new transaction for each get to see the latest data
		while ((await transaction(() => Table.get(target))).status !== 'ready') {
			await delay(100);
		}
		return Table.get(target);
	}
}
```

**`Table.get` with `loadedFromSource` check:**

```javascript
import { tables } from 'harper';

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

## Notes

- Use `getContext` (imported from `harper`) to access the current transaction anywhere in application code without passing context explicitly through every call.
- Harper functions and APIs should be accessed through the `harper` package rather than through global variables.
- Use `static` methods on Resources/Tables to implement endpoints, and access request information from the request `target` argument or via `getContext`.
- `lockdown: none` is only a temporary workaround for dependencies that mutate intrinsic prototypes at runtime; do not leave it set in production.
- Under `lockdown: ses`, the constrained (https-only) `fetch` is applied only in `vm` mode. In `vm-current-context` and `native` modes, application code uses the standard global `fetch`.
- In production, `allowedDirectory: app` is the default; dev mode installs default to `allowedDirectory: any`.
