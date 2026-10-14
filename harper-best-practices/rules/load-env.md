---
name: load-env
description: >-
  How to load environment variables from .env files into a Harper application
  using the loadEnv plugin.
metadata:
  mode: generate
  sources:
    - reference/v5/environment-variables/overview.md
  sourceCommit: 2dde0597443a13af0c753f2adbe528e8442d8ee4
  inputHash: 51b7b4f21b275eec
---

# Load Environment Variables with loadEnv

Instructions for the agent to follow when loading environment variables from `.env` files into a Harper application using the `loadEnv` plugin.

## When to Use

Apply this rule when a Harper application needs to supply secrets, API endpoints, or other configuration values to component code via `process.env` without hardcoding them. Use this whenever a `.env` file must be loaded at application startup.

## How It Works

1. **Declare `loadEnv` first in `config.yaml`**: Place `loadEnv` before all other components so environment variables are available when dependent components start.

   ```yaml
   # config.yaml — loadEnv must come first
   loadEnv:
     files: '.env'
   ```

2. **Set the `files` option**: Provide one or more paths or glob patterns pointing to the env file(s) to load. This option is required.

3. **Access variables in component code**: After loading, all values from the specified files are available on `process.env` and shared across all components in the single Harper process.

4. **Control override behavior with `override`**: By default, existing environment variables take precedence over values in `.env` files. Set `override: true` to reverse this — loaded values will overwrite variables already present in the shell or container environment.

5. **Load multiple files when needed**: Specify a list or a glob pattern under `files`. Files are loaded in the order specified.

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

**Full `config.yaml` with `loadEnv` declared first:**

```yaml
# config.yaml — loadEnv must come first
loadEnv:
  files: '.env'

rest: true

myApp:
  files: './src/*.js'
```

**Override existing environment variables:**

```yaml
loadEnv:
  files: '.env'
  override: true
```

**Load multiple files as a list:**

```yaml
loadEnv:
  files:
    - '.env'
    - '.env.local'
```

**Load multiple files using a glob pattern:**

```yaml
loadEnv:
  files: 'env-vars/*'
```

## Notes

- `loadEnv` is built into Harper — it does not need to be installed, only declared in `config.yaml`.
- Variables are loaded onto `process.env` and shared across all components. Declare `loadEnv` before any component that depends on those variables.
- `loadEnv` supplies **application** environment variables only. It does **not** configure Harper itself. Harper's own configuration is composed at startup before any `loadEnv` runs, so variables such as `HARPER_CONFIG`, `HARPER_SET_CONFIG`, and `HARPER_DEFAULT_CONFIG` delivered through a `.env` file are read too late and are ignored.
- To change Harper's own configuration, use the configuration file directly or export variables in the real process/container environment before Harper starts.
- For production credentials, prefer the encrypted secrets store over a committed `.env` file. Secrets are delivered to components via `process.env` and never appear in operation logs or replication payloads.
- Individual `.env` values can also be stored encrypted so plaintext never reaches the API, logs, or replication payload.
