---
name: running-dev-instances-in-worktrees
description: Run multiple Harper dev instances in parallel from git worktrees with isolated data roots, ports, and lock files.
---

# Running multiple Harper dev instances out of git worktrees

Pattern for working on a Harper app from several `git worktree`s in parallel — typically one per Claude Code session, branch, or experiment — without the Harper instances stepping on each other.

This document is Harper-specific but project-agnostic. The example scripts below live in `scripts/start-harper-dev.js` and `scripts/setup-harper.js` of any project that adopts this pattern; substitute your project's name where you see `<project>`.

---

## 1. Why this is non-trivial for Harper

Two unrelated isolation problems stack on top of each other:

**Filesystem state.** Vanilla git worktrees give each branch its own working tree on disk, so edits in one don't shift what another sees. That part is just `git worktree add`.

**Harper runtime state.** A single `harperdb run .` (or `harper dev .`) process holds:

- Default ports `9926` (HTTP), `9925` (Operations API), `1883`/`8883` (MQTT), `9933` (replication) on `0.0.0.0`.
- An LMDB write lock on its data root (`hdb/` by default).
- A chokidar watcher rooted at the application directory.
- A `harper-application-lock.json` file inside the data root.

Two Harper processes started against the same defaults will fight over all four. Even if you give them different ports manually, they'll still share the LMDB lock and the watcher's view of the world.

So worktree-per-branch alone is not enough. Each worktree needs its own Harper _instance_ — its own ports (or its own bind address), its own data root, its own lock file.

### Three failure modes if you don't isolate properly

Document these so future-you doesn't re-discover them:

1. **Hot-reload loop when `hdb/` lives under cwd.** Harper Pro's component watcher (chokidar in `harper-pro/.../manageThreads.js#watchDir`) recursively watches the `RUN_HDB_APP` directory and excludes only paths whose absolute path string contains `node_modules` or `.git`. If your data root is `<cwd>/hdb/`, every write to `hdb/log/hdb.log` and `hdb/harper-application-lock.json` is seen as a code change → reload → restart → more log writes → infinite loop. Fix: put the data root _outside_ the project tree.

2. **Silent LMDB lock contention.** If two worktrees both use the global default data root (`~/harper/`, or whatever `harper install` chose), the second `harper dev .` either fails to acquire the LMDB write lock or — worse — appears to start, reads stale data, and produces replication corruption. Fix: per-worktree data root, keyed on a hash of the worktree's absolute path.

3. **`EADDRINUSE` on default ports.** Two Harpers can't both bind `0.0.0.0:9926`. The naive fix (shift ports per worktree) creates per-worktree config drift — every URL, every `APP_BASE_URL`, every dev tool needs to know which slot it's in. Better fix: keep default ports, vary the _bind address_. Each Harper binds `127.0.0.N:9926` for some unique `N`. From the browser, the URL just changes from `http://127.0.0.1:9926/` to `http://127.0.0.3:9926/`, and nothing inside Harper's config changes.

---

## 2. The architecture

Two scripts plus one npm package.

```
scripts/setup-harper.js        # one-time per worktree: scaffold the data root
scripts/start-harper-dev.js    # every dev start: allocate IP, exec harper dev .
@harperfast/integration-testing  # devDep — file-locked loopback IP pool
```

Plus an npm script that ties them together:

```json
{
	"scripts": {
		"dev": "node scripts/start-harper-dev.js",
		"setup-harper": "node scripts/setup-harper.js",
		"setup-loopback": "harper-integration-test-setup-loopback"
	},
	"devDependencies": {
		"@harperfast/integration-testing": "^0.3.0"
	}
}
```

### How the pieces fit

```
git worktree add .claude/worktrees/foo -b foo
cd .claude/worktrees/foo
cp ../../.env .                       # copy (do not symlink) .env
ln -s ../../models models             # symlink models/ if you have one
npm install                           # real install — do NOT symlink node_modules
npm run dev                           # → scripts/start-harper-dev.js
                                      #     ├── ensures ~/.<project>-dev/hdb-<sha12>/ exists
                                      #     │   (calls setup-harper.js if not)
                                      #     ├── allocates 127.0.0.N from the loopback pool
                                      #     ├── writes .harper-instance for tooling
                                      #     └── execs `harper dev . --ROOTPATH=<dir>
                                      #                   --HTTP_PORT=127.0.0.N:9926 ...`
```

### What the wrapper does, in order

1. **Scrub empty inherited env shadows.** Harper's `loadEnv` refuses to override anything already set on `process.env`, even an empty string. If your shell exported `FOO=` before you ran `npm run dev`, the value in `.env` will be silently lost. The wrapper reads `.env`, identifies any var whose live value is the empty string, and `delete`s it from `process.env` so `loadEnv` can populate it from the file.

2. **Ensure the per-worktree data root exists.** The data root path is `~/.<project>-dev/hdb-<sha12>/`, where `<sha12>` is the first 12 hex chars of `SHA-256(realpathSync(cwd))`. Same cwd → same dir; different cwd (i.e. a different worktree) → different dir. If `harper-config.yaml` doesn't exist inside that dir, the wrapper synchronously runs `setup-harper.js`.

3. **Allocate a loopback address.** Calls `getNextAvailableLoopbackAddress()` from `@harperfast/integration-testing`. That function grabs a file-locked slot from a shared pool at `<os.tmpdir()>/harper-integration-test-loopback-pool.json`, returns `127.0.0.N`, and tracks the holding PID. Slots auto-free when the holding process dies (the next allocation observes the dead PID via `process.kill(pid, 0)` and reclaims it). Default pool size is 32 — bump via `HARPER_INTEGRATION_TEST_LOOPBACK_POOL_COUNT`.

4. **Write `.harper-instance`** to cwd so QA agents, IDE plugins, and other tooling can discover this worktree's URL without scraping logs:

   ```json
   { "hostname": "127.0.0.3", "hdbDir": "/Users/you/.<project>-dev/hdb-...", "pid": 12345 }
   ```

5. **Exec Harper.** Builds Pro's `host:port` argument syntax for every listener:

   ```
   harper dev . \
     --ROOTPATH=<HDB_DIR> \
     --NODE_HOSTNAME=127.0.0.N \
     --HTTP_PORT=127.0.0.N:9926 \
     --OPERATIONSAPI_NETWORK_PORT=127.0.0.N:9925 \
     --MQTT_NETWORK_PORT=127.0.0.N:1883 \
     --MQTT_NETWORK_SECUREPORT=127.0.0.N:8883
   ```

   Plus env vars `ROOTPATH=<HDB_DIR>` (triggers Pro's `noBootFile()` short-circuit so the per-worktree `harper-config.yaml` wins over the global `~/.harperdb/harperdb.properties`) and `APP_BASE_URL=http://127.0.0.N:9926` (so anything in your app that reads `APP_BASE_URL` for outbound URL generation matches the bound address).

6. **Cleanup.** On `SIGINT`/`SIGTERM` or graceful exit, deletes `.harper-instance` and calls `releaseAllLoopbackAddressesForCurrentProcess()` to free the pool slot.

### What `setup-harper.js` does

Spawns `harper install` non-interactively — once per worktree, idempotent. The trick is making Harper Pro's "already installed" guard _not_ trip on the system-wide install:

- `HOME` is overridden to `~/.<project>-dev/install-home-<sha12>/` for the duration of the install. Pro's guard reads `~/.harperdb/harperdb.properties` to decide whether to skip; with a fresh isolated `HOME`, the file doesn't exist and install proceeds.
- `ROOTPATH=<HDB_DIR>` directs install's output into the per-worktree dir.
- `HDB_ADMIN_USERNAME`/`HDB_ADMIN_PASSWORD`/`NODE_HOSTNAME`/`DEFAULTS_MODE` satisfy Pro's interactive prompts. The admin password is throwaway random — typical app-level auth (session cookies, JWTs, etc.) doesn't depend on Harper's super_user.
- After install lands `harper-config.yaml` + the `database/`, `components/`, `log/`, `keys/`, `backup/` subdirs, the isolated HOME is deleted (the runtime doesn't need it — `start-harper-dev.js` sets `ROOTPATH` directly).

### Why outside the project tree, again

Restating because this is the single biggest gotcha: Harper's component watcher will watch _anywhere under your application directory_ that isn't in `node_modules` or `.git`. If you put the data root at `<cwd>/hdb/`, every log line Harper writes is a "code change" to its own watcher → reload → infinite loop. The data root must live somewhere chokidar won't notice. `~/.<project>-dev/` is the convention here, but anywhere outside cwd works.

---

## 3. One-time machine setup

### macOS / Windows: enable the loopback IP pool

Linux aliases `127.0.0.0/8` to `lo` automatically. macOS only aliases `127.0.0.1`; everything else has to be added explicitly. Windows is similar.

```bash
npm run setup-loopback   # uses sudo
```

This delegates to `harper-integration-test-setup-loopback` (shipped by `@harperfast/integration-testing`), which runs `sudo ifconfig lo0 alias 127.0.0.$i up` for each address in the pool range. The aliases survive until the next reboot — re-run after every restart.

If you skip this step, the wrapper fails with a `LoopbackAddressValidationError` and tells you what to run. Pool exhaustion (more than 32 simultaneous worktrees) hangs the wrapper; raise the limit with `HARPER_INTEGRATION_TEST_LOOPBACK_POOL_COUNT=64` or kill some Harpers.

### `.gitignore` additions

```
.harper-instance
.claude/worktrees/
```

`.harper-instance` is per-running-process metadata — never check it in. The `.claude/worktrees/` line is convention-dependent; see §4 below.

---

## 4. Per-worktree workflow

### Convention: where worktrees live

Put them under `.claude/worktrees/<branch-name>/` inside the main checkout. The dir is gitignored (the checkout itself is a separate working tree, not tracked by the parent). This keeps everything project-local and easy to discover with `git worktree list`.

```bash
# From the main checkout:
git worktree add .claude/worktrees/my-feature -b my-feature
cd .claude/worktrees/my-feature
```

### Bring `.env` and `models/` across

Both are gitignored, both are needed for the app to boot.

```bash
# .env: copy (so each worktree can diverge if needed during testing)
cp ../../.env .

# models/ (or any large gitignored asset that's expensive to regenerate):
# symlink, since it's read-only and identical across worktrees
ln -s ../../models models
```

Skip the `models/` step if your project has no local model assets.

### Do NOT symlink `node_modules/`

Harper's sandbox loader rejects symlinked packages with `Can not load module outside of application folder`. You need a real install per worktree:

```bash
npm install
```

Cheap most of the time — deps don't change every commit. If install is slow, check whether you've accidentally pulled an `npm install --force --omit=dev` somewhere (which strips devDeps in place — see your project's CLAUDE.md if you have rules around this).

### Start Harper

```bash
npm run dev
```

First run in a new worktree triggers `setup-harper.js`, which takes 10–30 seconds. Subsequent runs skip straight to address allocation and boot. The console prints the bound URL:

```
Starting Harper dev server on http://127.0.0.3:9926
  rootPath: /Users/you/.<project>-dev/hdb-a1b2c3d4e5f6
  loopback: 127.0.0.3 (default ports — http 9926, ops 9925, mqtt 1883/8883)
```

Open that URL in a browser. Each worktree has its own database, so you'll go through any first-run bootstrap (creating an admin user, seeding default data, etc.) once per worktree.

---

## 5. Tooling integration

### Discovering the active dev URL

Any agent, script, or IDE plugin that needs to talk to "the dev server for this worktree" can read `.harper-instance`:

```bash
if [ -f .harper-instance ]; then
  HOSTNAME=$(node -p "JSON.parse(require('fs').readFileSync('.harper-instance','utf8')).hostname")
  HARPER_URL="http://$HOSTNAME:9926"
else
  HARPER_URL="http://localhost:9926"
fi
```

The file is present iff Harper is currently running in this worktree. It's deleted on graceful exit; if it survives a crash, the holding PID inside it is dead and the loopback slot will be reclaimed on the next allocation.

### Subagents / spawned tools

If you `cd` into a worktree and then spawn a subagent (Claude Code, an LSP, etc.), be aware that the subagent may inherit the _parent process's_ CWD, not yours. Pass the worktree path explicitly when invoking subprocesses that need to find `.harper-instance`.

---

## 6. Cleanup

### Tearing down a worktree

```bash
# From the main checkout:
git worktree remove .claude/worktrees/my-feature
git branch -d my-feature                                      # if merged
rm -rf ~/.<project>-dev/hdb-<the-sha12-for-that-worktree>/    # optional — frees ~100 MB+
```

Per-worktree data roots are _not_ automatically deleted when you remove the worktree. They're cheap to keep around (handy if you reuse the branch name later) but easy to wipe.

### Re-bootstrapping a worktree

```bash
# Fresh database, same code:
rm -rf ~/.<project>-dev/hdb-<sha12>/
npm run dev   # setup-harper.js will rebuild it
```

### Wiping every worktree's data

```bash
rm -rf ~/.<project>-dev/
```

Only touches Harper data roots — your worktrees, source code, and `.env` files stay put.

### Freeing a stuck loopback slot

If the wrapper hangs on "allocating loopback" or you suspect a stuck slot:

```bash
cat "$(node -p 'require("os").tmpdir()')/harper-integration-test-loopback-pool.json"
# → array indexed 0..31, value is { pid, ... } or null
```

Kill any holding PID that's no longer relevant; the next allocation observes the dead PID and frees the slot. Or delete the pool file entirely — it'll rebuild empty on the next allocation.

---

## 7. Adapting the scripts to a new project

When you copy `scripts/start-harper-dev.js` and `scripts/setup-harper.js` into a new Harper repo, the only project-specific knob is the data-root namespace:

```js
// in both scripts:
const HDB_DIR = join(homedir(), '.<your-project>-dev', `hdb-${ID}`);
```

Pick a kebab-case project name. Everything else — the SHA-keyed subdir, the loopback allocation, the install flags, the runtime CLI args — is identical across Harper apps.

Add the matching npm scripts and devDep to `package.json`:

```json
{
	"scripts": {
		"dev": "node scripts/start-harper-dev.js",
		"setup-harper": "node scripts/setup-harper.js",
		"setup-loopback": "harper-integration-test-setup-loopback"
	},
	"devDependencies": {
		"@harperfast/integration-testing": "^0.3.0"
	}
}
```

Add to `.gitignore`:

```
.harper-instance
.claude/worktrees/
```

That's it. The scripts have no other project-specific assumptions.

---

## 8. Debugging signals — what's normal vs. what's a bug

**Normal:**

- `.harper-instance` in cwd while Harper is running, gone after graceful exit.
- One `harper` child process per active worktree, each bound to its own `127.0.0.N`. Verify with `lsof -iTCP -sTCP:LISTEN | grep ^harper` — each row holds 9926/9925/1883/8883 on a distinct address.
- `~/.<project>-dev/hdb-<sha12>/harper-application-lock.json` exists while that Harper is running. Per-worktree, not machine-wide.
- `npm run dev` resolves to `node scripts/start-harper-dev.js`, NOT `harper dev .` directly.
- `APP_BASE_URL` env var on the harper child differs from `.env`'s value when bound to a non-default loopback (the wrapper exports the actual address-bearing URL).
- `<os.tmpdir()>/harper-integration-test-loopback-pool.json` and `.lock` files — shared with Harper's own integration tests, intentional.

**Suspicious — actually a bug:**

- Wrapper exits with `LoopbackAddressValidationError` → run `npm run setup-loopback` (one-time-per-reboot sudo step on macOS/Windows).
- Pool full (>32 worktrees) → wrapper waits indefinitely. Kill stale Harpers or bump `HARPER_INTEGRATION_TEST_LOOPBACK_POOL_COUNT`.
- `harper dev .` invoked directly (bypassing the wrapper) → won't allocate from the pool, won't set `ROOTPATH`, will use the global data root, will bind `0.0.0.0`, will likely collide with wrapper-managed Harpers. Always go through `npm run dev`.
- Repeated reload loops with `Reloaded Harper components, changed files: [...hdb/log/hdb.log...]` → data root somehow ended up under cwd (someone overrode `HDB_DIR` manually, or symlinked `hdb/` into the project). Move it back outside cwd.
- Mystery `ERR_MODULE_NOT_FOUND` from `~/hdb/components/<project>/` paths → there's a stale copy of the project in the _global_ Harper components dir from a past `harperdb deploy .` against localhost. `rm -rf ~/hdb/components/<project>` and use only `npm run dev`.
- `setup-harper` exits with "harper install failed" → the global `harper` binary isn't on PATH, the disk is out of space, or Pro changed its install prompt schema. Partial state in `~/.<project>-dev/` is safe to `rm -rf` and retry.
