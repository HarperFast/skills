# Harper Local Development

Guidelines for running and managing Harper on a developer machine: isolated dev instances, parallel instances across git worktrees, and the local tooling around them.

## 1. Dev Instances

### 1.1 Running Dev Instances in Git Worktrees

How to run one Harper dev instance per git worktree (or per agent session) on the same machine without the instances colliding. This skill ships a ready-to-copy wrapper script, `scripts/harper-dev.mjs`, that does all of it.

#### When to Use

- You, or several agents, work on one Harper app in parallel `git worktree`s and each needs a running server.
- A second `harper dev .` fails with `EADDRINUSE`, or exits with `Error: Harper is already running`.
- You are setting up a project's `npm run dev` so it is safe to start from any checkout.

#### How It Works

##### What collides

A Harper process claims two things that a second instance started from another worktree would also try to claim:

| Shared by default                                                                                                       | What goes wrong                                                                                                                     | Isolate with                            |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Listeners: 9926 (HTTP), 9925 (operations API), 1883/8883 (MQTT), 9933 (replication, Harper Pro), 9229 (debugger in dev) | `EADDRINUSE`                                                                                                                        | A per-instance loopback address         |
| The data root (wherever `~/.harperdb/hdb_boot_properties.file` points, usually `~/harper`)                              | The second start exits with code 4 because `hdb.pid` is held; taking turns means every branch shares one database and component set | A per-worktree data root, keyed on path |

**Vary the address, not the port.** Each instance binds the default ports on its own loopback address: `http://127.0.0.3:9926`, `http://127.0.0.7:9926`. No config, `.env` or tooling needs per-worktree port numbers. Browsers scope cookies by host, not port, so sessions don't leak between instances either.

**Keep the data root outside the app directory.** Harper writes logs, config, backups and lock files into its data root continuously. Inside the app directory, those writes reach anything watching it (a component with a broad `files` glob, Harper's legacy `WATCH_DIR` watcher, Vite or other dev tooling) and can set off a reload loop. They would also show up in `git status`.

##### What the wrapper does

`scripts/harper-dev.mjs` is a dependency-free wrapper around `harper dev .`. On every start it:

1. Derives the data root from the checkout path: `~/.harper-dev/<dir-name>-<first 12 hex of sha256(realpath)>/`. The same checkout always gets the same root; another worktree gets another.
2. Claims a loopback address from `127.0.0.2` to `127.0.0.33`. Claims are lock files under `<os.tmpdir()>/harper-dev-loopback/` holding the wrapper's PID, and dead owners' claims are taken over. It starts from a slot derived from the path, so a worktree usually keeps its URL, and skips any address where one of Harper's ports is already in use.
3. Deletes inherited environment variables that are set to `''` but defined in `.env`. Harper's `loadEnv` never overrides a variable that is already set, even to an empty string, so the `.env` value would be silently lost.
4. Writes `.harper-instance` (URL, host, data root, wrapper PID) into the checkout for tooling.
5. Runs Harper with every listener bound to the claimed address. A `host:port` value binds only that address; a bare port binds all interfaces.

   ```bash
   harper dev . --ROOTPATH=<data root> \
     --HTTP_PORT=127.0.0.N:9926 --OPERATIONSAPI_NETWORK_PORT=127.0.0.N:9925 \
     --MQTT_NETWORK_PORT=127.0.0.N:1883 --MQTT_NETWORK_SECUREPORT=127.0.0.N:8883 \
     --REPLICATION_SECUREPORT=127.0.0.N:9933 --THREADS_DEBUG_HOST=127.0.0.N
   ```

6. On the first start the data root has no `harper-config.yaml`, so `harper dev` installs one in place without prompting. It uses `DEFAULTS_MODE=dev`, `HDB_ADMIN_USERNAME` (default `admin`) and `HDB_ADMIN_PASSWORD` (default random, printed once). There is no separate install step. Pass the data root as the `--ROOTPATH` flag: unlike the `ROOTPATH` env var, the flag also overrides the global install's boot file.
7. Forwards Ctrl-C, `SIGTERM` and `SIGHUP` to Harper, then removes `.harper-instance` and its address claim when Harper exits.

It refuses to start when this checkout already has a live instance, or when an orphaned Harper (left by a `kill -9` of the wrapper) still holds the data root.

#### Setup

The wrapper is tested with Harper 5.3 on macOS (core and Pro) and Linux (core).

##### Once per machine (macOS only)

Linux routes all of `127.0.0.0/8` to loopback. macOS only configures `127.0.0.1`, so alias the range. The aliases last until the next reboot:

```bash
for i in $(seq 2 33); do sudo ifconfig lo0 alias 127.0.0.$i up; done
```

To keep them across reboots, install the launchd daemon that `@harperfast/integration-testing` ships (see "Persisting across reboots" in its README). It aliases the same range, which that package's integration-test pool also uses.

##### Once per project

1. Copy `scripts/harper-dev.mjs` from this skill into the app, e.g. as `scripts/harper-dev.mjs`. It is also at `https://raw.githubusercontent.com/HarperFast/skills/main/harper-local-dev/scripts/harper-dev.mjs`.
2. Point the dev script at it in `package.json`:

   ```json
   { "scripts": { "dev": "node scripts/harper-dev.mjs" } }
   ```

3. Add `.harper-instance` to `.gitignore`.
4. If the app reads its own public URL from an env var (for OAuth redirects or links in emails), add that variable to `URL_ENV_VARS` at the top of the script. Values the wrapper sets win over `.env`. Every instance also gets `HARPER_DEV_URL`.

The wrapper runs `harper` from `PATH`. `npm run` puts `node_modules/.bin` first, so a project-local Harper wins over a global one. Set `HARPER_BIN` to pick a specific executable, such as Harper Pro.

##### Per worktree

```bash
git worktree add ../my-app-feature -b feature
cd ../my-app-feature
cp ../my-app/.env .   # gitignored files don't come along; copy so each worktree can diverge
npm install           # a real install per worktree
npm run dev
```

```
Harper dev instance for /Users/you/code/my-app-feature
  URL:        http://127.0.0.7:9926
  Operations: http://127.0.0.7:9925
  Data root:  /Users/you/.harper-dev/my-app-feature-a1b2c3d4e5f6 (new; installing)
  Admin:      admin / <generated password>
```

Worktrees can live anywhere, e.g. sibling directories, or `.claude/worktrees/<name>` the way Claude Code creates them (gitignore that directory). Each worktree has its own database, so seed data, users and any first-run bootstrap happen once per worktree.

Don't symlink `node_modules` between worktrees: branches' dependencies drift apart. With production defaults (`applications.allowedDirectory: app`), Harper also refuses modules that resolve outside the app with `Can not load module at ... outside of allowed path ...`. Large read-only assets that are gitignored, such as model files, can be symlinked instead of copied.

#### Finding the Instance from Tools

`.harper-instance` exists only while the instance is running:

```json
{
	"url": "http://127.0.0.7:9926",
	"operationsUrl": "http://127.0.0.7:9925",
	"host": "127.0.0.7",
	"rootPath": "/Users/you/.harper-dev/my-app-feature-a1b2c3d4e5f6",
	"pid": 12345
}
```

```bash
HARPER_URL=$(node -p "JSON.parse(require('fs').readFileSync('.harper-instance', 'utf8')).url" 2>/dev/null || echo http://localhost:9926)
```

Read it from the worktree you are working in. Subagents and spawned tools may start in the main checkout, so give them the worktree path explicitly.

With dev defaults the debugger listens on `<host>:9229`. In `chrome://inspect`, under Configure, add `127.0.0.7:9229`.

#### Differences from a Plain `harper dev .`

- New data roots get dev defaults: plain HTTP, CORS `*`, one thread, logs on stdout, and `authorizeLocal`, which treats every request from `127.0.0.x` as the super user. To exercise real authentication, run `npm run dev -- --AUTHENTICATION_AUTHORIZELOCAL=false`. Extra arguments are passed to Harper and saved in the instance's config.
- Harper only marks session cookies `SameSite=None; Secure` for `localhost` and `127.0.0.1`. On `127.0.0.N`, cross-site requests don't carry the session; same-site browsing is unaffected.
- Services that allow-list origins or redirect URIs, such as OAuth providers, need the `127.0.0.N` origin added.
- On a machine with no global Harper install, the first instance's install points `~/.harperdb/hdb_boot_properties.file` at its data root. Bare `harper` commands without `--ROOTPATH` then act on that instance; other instances are unaffected.

#### Cleanup

```bash
git worktree remove ../my-app-feature
rm -rf ~/.harper-dev/my-app-feature-a1b2c3d4e5f6   # optional; the path is printed at startup
```

Data roots outlive their worktrees, and moving or renaming a checkout starts a new one. Delete a root to re-bootstrap that worktree, or `rm -rf ~/.harper-dev` to reset them all. Neither touches source code, `.env` files or a global Harper install.

#### Troubleshooting

| Message or symptom                                          | Cause and fix                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loopback addresses ... are not configured`                 | The macOS aliases are missing; they reset on reboot. Run the alias loop above.                                                                                                        |
| `no free loopback address`                                  | Every address in the range is in use: stop some instances, or raise `HARPER_DEV_LOOPBACK_COUNT` and alias more addresses. On Linux, a Harper bound to all interfaces blocks them all. |
| `Harper is already running for this checkout`               | Use the URL it prints, or stop that instance first.                                                                                                                                   |
| `a Harper process from an earlier run is still using ...`   | The wrapper was killed without stopping Harper. Run the `kill` command it prints.                                                                                                     |
| `Can not load module at ... outside of allowed path ...`    | `node_modules`, or a package in it, is a symlink pointing outside the app. Run a real `npm install` in the worktree.                                                                  |
| A value from `.env` is ignored                              | The variable is already set in the environment, and non-empty values from the shell win. Unset it, or use `loadEnv`'s `override: true`.                                               |
| Startup banner shows `http://127.0.0.7:127.0.0.7:9926/`     | Cosmetic: Harper's banner repeats the host when the port is given as `host:port`. The listener is correct.                                                                            |
| `domainSocket ... exceeds the 103-byte ... limit` (warning) | `HARPER_DEV_HOME` is a long path on macOS, so the operations API's Unix socket is skipped; TCP still works. Use a shorter `HARPER_DEV_HOME`.                                          |
