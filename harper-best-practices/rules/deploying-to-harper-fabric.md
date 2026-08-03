---
name: deploying-to-harper-fabric
description: How to deploy a Harper application to the Harper Fabric cloud.
metadata:
  mode: generate
  sources:
    - reference/v5/components/applications.md#Remote Management
    - >-
      fabric/cluster-creation-management.md#Connecting the Harper CLI to a
      Cluster
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: 39faf283b6964e93
---

# Deploying to Harper Fabric

Instructions for the agent to follow when deploying a Harper application to a remote Harper Fabric cloud instance.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster or any remote Harper instance. Use it when setting up CI/CD pipelines that push application packages to a target environment, or when deploying from a local directory or external package source to a remote cluster.

## How It Works

1. **Obtain the target URL**: Get the cluster's **Application URL** from the cluster's **Config → Overview** page. This is the hostname passed to all CLI commands as `target`.

2. **Authenticate with `harper login`**: Run `harper login` once to store an authentication token locally. The CLI also writes `HARPER_CLI_TARGET` to a local `.env` for subsequent commands.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) for setting up a cluster before this step.

3. **Deploy with `harper deploy`**: After logging in, deploy without repeating credentials.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

4. **Use environment variables for CI/CD**: Instead of `harper login`, export credentials as environment variables before running `harper deploy`.

   ```bash
   export HARPER_CLI_USERNAME=<username>
   export HARPER_CLI_PASSWORD=<password>
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

5. **Use inline auth parameters for one-off commands**: Pass `auth_username` and `auth_password` directly. These take precedence over environment variables and saved login tokens. Not recommended for production.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     auth_username=<username> \
     auth_password=<password> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

6. **Choose a package source**: Set the `package` parameter to any valid npm dependency value, or omit it to package and deploy the current local directory.

   | Value                                                | Meaning                                        |
   | ---------------------------------------------------- | ---------------------------------------------- |
   | _(omitted)_                                          | Package and deploy the current local directory |
   | `"@harperdb/status-check"`                           | npm package                                    |
   | `"HarperDB/status-check"`                            | GitHub shorthand                               |
   | `"https://github.com/HarperDB/status-check"`         | GitHub full URL                                |
   | `"git+ssh://git@github.com:HarperDB/secret-app.git"` | Private repo via SSH                           |
   | `"https://example.com/application.tar.gz"`           | Remote tarball                                 |

   For pinned git tags, use the `semver` directive:

   ```
   HarperDB/application-template#semver:v1.0.0
   ```

   For SSH-based private repos, register keys with the `Add SSH Key` operation before deploying.

## Examples

**Interactive login then deploy:**

```bash
harper login https://my-cluster.harperdbcloud.com
# Enter username and password when prompted

harper deploy \
  project=my-app \
  package="HarperDB/application-template#semver:v1.0.0" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**CI/CD pipeline deploy using environment variables:**

```bash
export HARPER_CLI_USERNAME=admin
export HARPER_CLI_PASSWORD=secret
harper deploy \
  project=my-app \
  package="@harperdb/status-check" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy current local directory:**

```bash
harper deploy \
  project=my-app \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

## Notes

- Authentication precedence (highest to lowest): inline `auth_username`/`auth_password` parameters → environment variables (`HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`) → saved login token from `harper login`.
- `harper login` writes `HARPER_CLI_TARGET` to a local `.env`, so subsequent commands do not need `target` repeated if that file is present.
- Harper generates a `package.json` from component configurations and resolves packages via `npm install`. A local file path creates a symlink, so changes are picked up between restarts without redeploying.
- For SSH-based private repos, register the SSH key with the `Add SSH Key` operation before running `harper deploy`.
