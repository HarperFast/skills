---
name: load-env
description: >-
  How to load environment variables from .env files into a Harper application
  using the loadEnv plugin.
metadata:
  mode: generate
  sources:
    - reference/v5/environment-variables/overview.md
  sourceCommit: b7fbddadd42eb4487190b650a9abc4bcfeef5819
  inputHash: c73a0caf28a2b833
---

# Load Environment Variables with loadEnv

Instructions for the agent to follow when loading environment variables from `.env` files into a Harper application using the `loadEnv` plugin.

## When to Use

Apply this rule when a Harper application needs to load secrets or configuration values from `.env` files into `process.env` at startup. Use it whenever you need to configure `loadEnv` in `config.yaml`, control load order, handle multiple files, or manage override behavior.

## How It Works

1. **Declare `loadEnv` in `config.yaml`**: Add `loadEnv` to your `config.yaml` with a `files` key pointing to the `.env` file. `loadEnv` is built into Harper and does not need to be installed separately.

   ```yaml
   loadEnv:
     files: '.env'
   ```

   This loads the specified file from the root of your component directory into `process.env`.

2. **Place `loadEnv` first**: Always declare `loadEnv` before any other components in `config.yaml` so environment variables are available before dependent components start. Because Harper is single-process, variables loaded onto `process.env` are shared across all components.

   ```yaml
   # config.yaml — loadEnv must come first
   loadEnv:
     files: '.env'

   rest: true

   myApp:
     files: './src/*.js'
   ```

3. **Control override behavior**: By default, existing shell or container environment variables take precedence over values in `.env` files. To force `.env` values to overwrite existing variables, set `override: true`.

   ```yaml
   loadEnv:
     files: '.env'
     override: true
   ```

4. **Load multiple files**: Provide a list of files or a glob pattern under `files`. Files are loaded in the order specified.
   ```yaml
   loadEnv:
     files:
       - '.env'
       - '.env.local'
   ```
   Or using a glob pattern:
   ```yaml
   loadEnv:
     files: 'env-vars/*'
   ```

## Examples

A complete `config.yaml` using `loadEnv` with multiple files and override enabled:

```yaml
# config.yaml — loadEnv must come first
loadEnv:
  files:
    - '.env'
    - '.env.local'
  override: true

rest: true

myApp:
  files: './src/*.js'
```

A minimal setup loading a single `.env` file:

```yaml
loadEnv:
  files: '.env'

myApp:
  files: './src/*.js'
```

## Notes

- `loadEnv` is built into Harper — declare it in `config.yaml` only; do not install it as a separate package.
- The `files` value accepts either a single string, a list of strings, or a glob pattern.
- Without `override: true`, variables already present in the environment are never overwritten by values in `.env` files.
- `process.env` is shared across all Harper components in the same process, so load order in `config.yaml` determines availability.
