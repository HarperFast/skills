---
name: v5-upgrade
description: >-
  Breaking changes and recommended updates when migrating a Harper application
  to v5.
metadata:
  mode: generate
  sources:
    - release-notes/v5-lincoln/v5-migration.md
  sourceCommit: de2aaf1c759a7ff5b93e862ba704153e2a392fcb
  inputHash: 80314689f3a7f42e
---

# Upgrading a Harper Application to v5

Instructions for the agent to follow when migrating an existing Harper application to version 5, addressing the breaking changes and adopting the recommended patterns.

## When to Use

Apply this rule when upgrading a Harper application from v4.x (or earlier) to v5, or when code written against older APIs behaves differently after a v5 upgrade — for example a record that can no longer be mutated, a query that returns stale data, or a `spawn` call that now throws. Harper v5 introduces breaking changes; applications built on documented APIs need the updates below, while code relying on undocumented behavior or timing may need broader review.

## How It Works

1. **Adopt the `harper` package name**: HarperDB is now Harper, and the package was renamed. Install the open source edition with `npm i -g harper` and the pro edition with `npm i -g @harperfast/harper-pro`. Update application imports from `harperdb` to `harper`:

   ```javascript
   import { tables } from 'harper';
   ```

2. **Opt in to install scripts when required**: Harper now installs packages with `--ignore-scripts` to guard against accidental script execution, a common security risk. If an application genuinely needs install scripts to run (for example to build native binaries), pass the `allowInstallScripts` option when deploying.

3. **Update `Table.get` return-value handling**: `Table.get` now returns a plain, frozen record object rather than an instance of the table class, so instance methods are no longer available on the result. The commonly used `wasLoadedFromSource()` method is gone; cache-vs-origin information now lives on the request `target` as `target.loadedFromSource`. Pass a `RequestTarget` to `Table.get` and read the flag from it. Because the record is frozen, create a copy instead of mutating it in place.

4. **Account for automatic transaction context**: With RocksDB, transactions are fully supported by the storage engine, and Harper v5 uses asynchronous context tracking to carry the current transaction across calls automatically. A nested `Table.get` now reads within the current transaction's snapshot, so it will not observe newly written data until you commit. Access the context through `getContext()` and either commit the current transaction (`getContext().transaction.commit()`) or run the read inside a fresh `transaction(...)` to see the latest data. This matters most for code executing outside the context of a Harper request.

5. **Register spawnable commands**: Spawning processes is now tightly controlled. `spawn`, `exec`, and `execFile` may only run executables listed in the `applications.allowedSpawnCommands` configuration, and each call must pass a `name` in its `options` so that only a single named process is started across Harper's multiple threads. Use a distinct `name` when you deliberately need a separate process.

6. **Return Response-like objects to set headers**: If a REST method returns an object with a `headers` property, Harper uses it as the response headers.

7. **Replace `blob.save()`**: The `blob.save()` method has been removed. Pass the `saveBeforeCommit` flag in the options to the `Blob` constructor instead.

8. **Configure the VM module loader**: v5 loads application modules through Node.js's VM module API, giving each application its own module cache and an application-scoped `harper` module. All of this is controlled by the `applications` section of `harperdb-config.yaml`:
   - `moduleLoader` — `vm-current-context` (default), `vm`, `native`, or `compartment`. The default shares intrinsics with Harper for best compatibility; choose `vm` only if you need per-application intrinsics, and `native` to disable the VM loader entirely (restores pre-v5 loading, but per-app `logger`/`config` context is unavailable).
   - `lockdown` — `freeze-after-load` (default), `freeze`, `ses`, or `none`. Freezing intrinsics prevents prototype-pollution attacks; set `lockdown: none` only as a temporary workaround if a dependency mutates built-in prototypes.
   - `allowedDirectory` — `app` (default) restricts module loading to the application's own directory tree; set `any` if the app must load files from outside it in production.
   - `allowedBuiltinModules` — an optional allowlist restricting which Node.js built-ins the application may import (all are allowed if omitted).
   - `dependencyLoader` — `auto` (default), `app`, or `native`, controlling how npm dependencies are loaded through or around the VM loader.

## Examples

**Updating `Table.get` and its cache check:**

```javascript
// Old (v4.x)
const record = await Table.get(id);
if (record.wasLoadedFromSource()) {
	// loaded from origin, not cache
}

// New (v5)
const target = new RequestTarget(); // passed in when overriding `get`
target.id = id;
const record = await Table.get(target);
if (target.loadedFromSource) {
	// loaded from origin, not cache
}
```

**Committing the transaction to read fresh data:**

```javascript
import { setTimeout as delay } from 'node:timers/promises';
import { getContext, transaction } from 'harper';

class MyResource {
	static async get(target) {
		// The current transaction is a consistent snapshot; commit it to see updates.
		await getContext().transaction.commit();
		while ((await transaction(() => Table.get(target))).status !== 'ready') {
			delay(100);
		}
		return Table.get(target);
	}
}
```

**Module loader and security configuration in `harperdb-config.yaml`:**

```yaml
applications:
  lockdown: freeze-after-load # default
  moduleLoader: vm-current-context # vm-current-context (default) | vm | native | compartment
  dependencyLoader: auto # auto (default) | app | native
  allowedDirectory: app # app (default) | any
  allowedSpawnCommands:
    - npm
    - node
  # allowedBuiltinModules: [] # if omitted, all Node.js built-ins are allowed
```

## Recommended Changes

Beyond the required fixes above, Harper v5 encourages these patterns for new and migrated code:

- Implement endpoints with `static` methods on Resources/Tables, reading request information from the request `target` argument (or from `getContext()`).
- Rely on automatic context propagation rather than threading context through every call manually; access it via `getContext()` exported from `harper`.
- Access Harper functions and APIs through the `harper` package rather than through global variables.
