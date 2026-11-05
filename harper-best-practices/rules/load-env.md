---
name: load-env
description: >-
  How to load environment variables from .env files into a Harper application
  using the loadEnv plugin.
metadata:
  mode: generate
  sources:
    - reference/v5/environment-variables/overview.md
  sourceCommit: 0a29827da61afe7fff40ee8de87e1d4c2c286bea
  inputHash: 857e9f99be831bad
---

# Load Environment Variables with loadEnv

Instructions for the agent to follow when loading environment variables from `.env` files into a Harper application using the `loadEnv` plugin.

**Instead of:** `dotenv`. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when a Harper application needs to supply secrets, API endpoints, or other configuration values to component code via `process.env` without hardcoding them. Use `loadEnv` whenever `.env` files must be loaded at application startup before other components run.

## How It Works

1. **Declare `loadEnv` first in `config.yaml`**: Place `loadEnv` before all other components so environment variables are available when dependent components start. Harper is single-process, so variables loaded onto `process.env` are shared across all components.

   ```yaml
   # config.yaml — loadEnv must come first
   loadEnv:
     files: '.env'

   rest: true

   myApp:
     files: './src/*.js'
   ```

2. **Configure the `files` option**: Specify one or more paths or glob patterns pointing to the env files to load. This option is required.

3. **Set `override` if needed**: By default, existing environment variables take precedence over values in `.env` files (`override` defaults to `false`). Set `override: true` to make loaded values overwrite existing environment variables.

4. **Access values in component code**: Read loaded variables from `process.env` as usual. No installation is needed — `loadEnv` is built into Harper.

### Configuration Options

| Option     | Type                 | Required | Description                                                                            |
| ---------- | -------------------- | -------- | -------------------------------------------------------------------------------------- |
| `files`    | `string \| string[]` | **Yes**  | Path(s) or glob pattern(s) to the env file(s) to load.                                 |
| `override` | `boolean`            | No       | If `true`, loaded values override existing environment variables. Defaults to `false`. |

## Examples

**Basic usage — load a single `.env` file:**

```yaml
loadEnv:
  files: '.env'
```

**Override existing environment variables:**

```yaml
loadEnv:
  files: '.env'
  override: true
```

**Load multiple named files (loaded in order specified):**

```yaml
loadEnv:
  files:
    - '.env'
    - '.env.local'
```

**Load files via glob pattern:**

```yaml
loadEnv:
  files: 'env-vars/*'
```

## Notes

- `loadEnv` does **not** need to be installed — it is built into Harper and only needs to be declared in `config.yaml`.
- `loadEnv` supplies **application** environment variables for component code. It does **not** configure Harper itself. Harper's own configuration is composed at startup before any `loadEnv` runs, so variables like `HARPER_CONFIG`, `HARPER_SET_CONFIG`, and `HARPER_DEFAULT_CONFIG` delivered through a `.env` file are read too late and are ignored.
- To change Harper's configuration, set it in the configuration file or export the variable in the process/container environment before Harper starts — not through `loadEnv`.
- The `harper` CLI reads a `.env` file in the current directory separately from `loadEnv`. Commands such as `harper deploy` will fail if the file sets CLI target, credentials, or proxy names (e.g., `HTTPS_PROXY`) unless those names are already set in the process environment. Keep such values in a differently named file listed under `files`, or set them in the process environment directly.
- For production credentials, prefer the encrypted, replicated secrets store over a committed `.env` file. Secrets are delivered to components via `process.env` and never appear in operation logs or replication payloads.
- A component's `.env` file can be managed remotely via the Operations API (`get_env_keys`, `set_env_value`, `delete_env_value`). Changes reach running code only after the node's worker threads restart.
