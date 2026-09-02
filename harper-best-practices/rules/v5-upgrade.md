---
name: v5-upgrade
description: >-
  Breaking changes and recommended updates when migrating a Harper application
  to v5.
metadata:
  mode: generate
  sources:
    - release-notes/v5-lincoln/v5-migration.md
  sourceCommit: 0d151a2c1f8d3988aef4dc6fc7deaa3e13f13589
  inputHash: c79514f0a3209c70
---

# v5 Upgrade: Breaking Changes and Migration Guide

Instructions for the agent to apply all breaking changes and recommended updates when migrating a Harper application to v5.

## When to Use

Apply this rule when upgrading an existing Harper application to v5, when encountering runtime errors related to renamed packages, changed APIs, or security restrictions introduced in v5, or when scaffolding new v5-compatible application code.

## How It Works

1. **Update the package import from `harperdb` to `harper`**: All application code must import from `harper`, not `harperdb`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable `allowInstallScripts` if packages require install scripts**: Harper v5 runs `npm install` with `--ignore-scripts` by default. If a dependency needs its install scripts to run (e.g., to compile native binaries), set `allowInstallScripts` in your deployment options.

3. **Update `Table.get` usage — return value is now a plain frozen record object**: `Table.get` no longer returns an instance of the table class. The returned object is frozen; you cannot mutate it directly.
   - Replace `wasLoadedFromSource()` with the `loadedFromSource` property on the `target` object:

     ```javascript
     // OLD — no longer works
     const record = await Table.get(id);
     if (record.wasLoadedFromSource()) {
     	/* ... */
     }

     // NEW
     const target = new RequestTarget(); // passed in automatically when overriding get()
     target.id = id;
     const record = await Table.get(target);
     if (target.loadedFromSource) {
     	// record was loaded from origin (not cache)
     }
     ```

   - Replace in-place mutation of records with object spread:

     ```javascript
     // OLD — throws in v5 because record is frozen
     const record = await Table.get(id);
     record.property = 'changed';

     // NEW
     let record = await Table.get(id);
     record = { ...record, property: 'changed' };
     ```

   - `getUpdatedTime` and `getExpiresAt` methods remain available on the record object.

4. **Update transaction and context handling — use `getContext`**: Harper v5 automatically propagates the current transaction via async context tracking. Code that previously passed no context to bypass a transaction will now unintentionally reuse the current transaction. Explicitly commit or start a new transaction where needed.

   ```javascript
   import { setTimeout as delay } from 'node:timers/promises';
   import { getContext, transaction } from 'harper';

   class MyResource {
   	static async get(target) {
   		// Explicitly commit the current transaction to read latest data
   		await getContext().transaction.commit();

   		// Optionally wrap each poll in a new transaction
   		while ((await transaction(() => Table.get(target))).status !== 'ready') {
   			await delay(100);
   		}
   		return Table.get(target);
   	}
   }
   ```

5. **Register `allowedSpawnCommands` for any child process usage**: `spawn` and `execFile` may only launch executables listed in `applications.allowedSpawnCommands`. `exec` is not usable through the substituted module, and `execSync` always throws. The `spawn`, `execFile`, and `fork` functions also require a `name` property in the options argument to prevent process multiplication across threads.

   ```yaml
   applications:
     allowedSpawnCommands:
       - npm
       - node
   ```

6. **Replace `blob.save()` with the `saveBeforeCommit` flag**: The `blob.save()` method has been removed. Pass `saveBeforeCommit` in the options object to the `Blob` constructor instead.

7. **Configure the `moduleLoader` and `lockdown` settings**: Harper v5 loads application modules through Node.js's VM module API. Control this behavior in `harper-config.yaml` under the `applications` key.

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

   | Setting            | Default              | Options                                             |
   | ------------------ | -------------------- | --------------------------------------------------- |
   | `moduleLoader`     | `vm-current-context` | `vm-current-context`, `vm`, `native`, `compartment` |
   | `lockdown`         | `freeze-after-load`  | `freeze-after-load`, `freeze`, `ses`, `none`        |
   | `dependencyLoader` | `auto`               | `auto`, `app`, `native`                             |
   | `allowedDirectory` | `app`                | `app`, `any`                                        |

8. **Handle frozen intrinsics from `lockdown`**: The default `freeze-after-load` mode freezes JavaScript intrinsics (`Object`, `Array`, `Promise`, `Map`, `Set`, etc.) after all application code loads. Any code or dependency that mutates intrinsic prototypes at runtime will throw a `TypeError`. Set `lockdown: none` as a temporary workaround if a dependency requires prototype mutation.

9. **Use `headers` on returned objects for response headers**: If a REST method returns an object with a `headers` property, Harper v5 will use it as the response headers.

## Examples

### Full `harper-config.yaml` VM loader configuration

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

### Disabling the VM loader for compatibility

```yaml
applications:
  moduleLoader: native
```

### Restricting allowed built-in modules

```yaml
applications:
  allowedBuiltinModules:
    - fs
    - path
    - http
```

### Updated `Table.get` with `loadedFromSource` and frozen record handling

```javascript
import { getContext, transaction } from 'harper';

const target = new RequestTarget();
target.id = id;
const record = await Table.get(target);

if (target.loadedFromSource) {
	// record was loaded from origin
}

// Safely modify a frozen record
let updated = { ...record, property: 'changed' };
```

### Response with `headers`

```javascript
class MyResource {
	static async get(target) {
		const data = await Table.get(target);
		return {
			...data,
			headers: { 'Cache-Control': 'no-store' },
		};
	}
}
```

## Notes

- Import all Harper functions and APIs from `from 'harper'`, not from global variables or `harperdb`.
- `getContext` is exported from `harper` and provides access to the current transaction without passing context explicitly.
- Under `lockdown: ses`, the constrained `fetch` (https-only) applies only in `vm` mode. In `vm-current-context` and `native` modes, application code uses the standard global `fetch`.
- Dev mode installs default to `allowedDirectory: any`; production defaults to `allowedDirectory: app`.
- `dependencyLoader: native` is a narrower option than `moduleLoader: native` — it uses native loading only for npm packages while keeping the VM loader for first-party application source files.
