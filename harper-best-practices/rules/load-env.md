---
name: load-env
description: >-
  How to load environment variables from .env files into a Harper application
  using the loadEnv plugin.
metadata:
  mode: generate
  sources:
    - reference/v5/environment-variables/overview.md
  sourceCommit: 489477b2259ba148f4e526ea4b5cd24041ceec03
  inputHash: 51b7b4f21b275eec
---

# Load Environment Variables with loadEnv

Instructions for the agent to follow when loading environment variables from `.env` files into a Harper application using the `loadEnv` plugin.

**Instead of:** `dotenv`. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when a Harper application needs to supply secrets, API endpoints, or other configuration values to component code via `process.env` without hardcoding them. Use this whenever a `.env` file must be loaded at application startup before other components run.

## How It Works

1. **Declare `loadEnv` first in `config.yaml`**: Place `loadEnv` before all other components so environment variables are available when dependent components start. Harper is single-process, so variables loaded onto `process.env` are shared across all components.

   ```yaml
   # config.yaml — loadEnv must come first
   loadEnv:
     files: '.env'
   ```

2. **Specify files to load**: Set the `files` option to a path, glob pattern, or list of paths. This is the only required option.

3. **Control override behavior**: By default, existing environment variables take precedence over values in `.env` files. Set `override: true` to make loaded values overwrite existing environment variables.

4. **Access values in component code**: After loading, all values from the specified files are available on `process.env` throughout your components.

### Configuration Options

| Option     | Type                 | Required | Description                                                                            |
| ---------- | -------------------- | -------- | -------------------------------------------------------------------------------------- |
| `files`    | `string \| string[]` | **Yes**  | Path(s) or glob pattern(s) to the env file(s) to load.                                 |
| `override` | `boolean`            | No       | If `true`, loaded values override existing environment variables. Defaults to `false`. |

## Examples

**Basic single file:**

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

**Multiple explicit files** (loaded in order specified):

```yaml
loadEnv:
  files:
    - '.env'
    - '.env.local'
```

**Glob pattern:**

```yaml
loadEnv:
  files: 'env-vars/*'
```

**Full `config.yaml` with dependent components:**

```yaml
# config.yaml — loadEnv must come first
loadEnv:
  files: '.env'

rest: true

myApp:
  files: './src/*.js'
```

## Notes

- `loadEnv` is built into Harper — do not install it separately. Only declare it in `config.yaml`.
- `loadEnv` supplies **application** environment variables for component code. It does **not** configure Harper itself.
- Harper's own configuration is composed at startup **before** any `loadEnv` runs. Variables such as `HARPER_CONFIG`, `HARPER_SET_CONFIG`, and `HARPER_DEFAULT_CONFIG` delivered through a `.env` file are read too late and are ignored. Set Harper configuration in the configuration file or export variables in the real process/container environment before Harper starts.
- A component's `.env` file can be managed remotely via the Operations API (`get_env_keys`, `set_env_value`, `delete_env_value`). Changes reach running code only after worker threads restart.
- For production credentials, prefer the encrypted secrets store over a committed `.env` file. Individual `.env` values can also be stored encrypted. See [Encrypted Environment Values](encrypted-values.md) and [Secrets](secrets.md).
