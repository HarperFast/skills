---
name: load-env
description: >-
  How to load environment variables from .env files into a Harper application
  using the loadEnv plugin.
metadata:
  mode: generate
  sources:
    - reference/v5/environment-variables/overview.md
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: b4db5ede6b93d426
---

# Load Environment Variables with loadEnv

Instructions for the agent to follow when loading environment variables from `.env` files into a Harper application using the `loadEnv` plugin.

## When to Use

Apply this rule when a Harper application needs to supply secrets, API endpoints, or other configuration values to component code via `process.env` without hardcoding them. Use `loadEnv` any time you need to load one or more `.env` files at application startup.

## How It Works

1. **Declare `loadEnv` in `config.yaml`**: Add `loadEnv` as the first entry in `config.yaml`. It is built into Harper and requires no installation.

   ```yaml
   loadEnv:
     files: '.env'
   ```

2. **Place `loadEnv` first**: Harper is a single-process application. List `loadEnv` before all other components so that environment variables are available on `process.env` before dependent components start.

   ```yaml
   # config.yaml — loadEnv must come first
   loadEnv:
     files: '.env'

   rest: true

   myApp:
     files: './src/*.js'
   ```

3. **Access loaded values in component code**: After `loadEnv` runs, all loaded values are available on `process.env` and shared across all components.

4. **Control override behavior**: By default, existing environment variables take precedence over values in `.env` files. Set `override: true` to make loaded values win instead.

   ```yaml
   loadEnv:
     files: '.env'
     override: true
   ```

5. **Load multiple files**: Pass an array of paths or a glob pattern to `files`. Files are loaded in the order specified.

   ```yaml
   loadEnv:
     files:
       - '.env'
       - '.env.local'
   ```

   or with a glob:

   ```yaml
   loadEnv:
     files: 'env-vars/*'
   ```

### Configuration Options

| Option     | Type                 | Required | Description                                                                            |
| ---------- | -------------------- | -------- | -------------------------------------------------------------------------------------- |
| `files`    | `string \| string[]` | **Yes**  | Path(s) or glob pattern(s) to the env file(s) to load.                                 |
| `override` | `boolean`            | No       | If `true`, loaded values override existing environment variables. Defaults to `false`. |

## Examples

**Single file, default behavior:**

```yaml
# config.yaml
loadEnv:
  files: '.env'

rest: true

myApp:
  files: './src/*.js'
```

**Multiple files with override:**

```yaml
# config.yaml
loadEnv:
  files:
    - '.env'
    - '.env.local'
  override: true

rest: true

myApp:
  files: './src/*.js'
```

## Notes

- `loadEnv` loads values into `process.env` for **application** code only — it does not configure Harper itself.
- Harper's own instance-wide configuration is composed at startup **before** any component's `loadEnv` runs. Variables such as `HARPER_CONFIG`, `HARPER_SET_CONFIG`, and `HARPER_DEFAULT_CONFIG` delivered through a `.env` file are read too late and are ignored. Set Harper configuration directly in the configuration file or export variables in the real process/container environment before Harper starts.
- For production credentials, prefer the encrypted secrets store over a committed `.env` file. Secrets are also delivered to components via `process.env`.
