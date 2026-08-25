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
  sourceCommit: 6bf676d4bde158fcd08a81565556a0ee91768274
  inputHash: 8c8b2fabac08a561
---

# Deploying to Harper Fabric

Instructions for the agent to follow when deploying a Harper application to a remote Harper Fabric cluster.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster or any remote Harper instance. This includes first-time deploys, redeployments, rollbacks, and CI/CD pipeline deployments. See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) to set up a cluster before deploying.

## How It Works

1. **Authenticate against the remote cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on the cluster's **Config → Overview** page). The CLI stores the token and writes `HARPER_CLI_TARGET` to a local `.env`.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

2. **Deploy the application**: Run `harper deploy` with the required parameters. After logging in, no credentials need to be repeated.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

3. **Choose a package source**: Set the `package` parameter to any valid npm dependency value, or omit it to package and upload the current local directory.

   | Value                                                | Effect                                           |
   | ---------------------------------------------------- | ------------------------------------------------ |
   | _(omitted)_                                          | Packages and deploys the current local directory |
   | `"@harperdb/status-check"`                           | npm package                                      |
   | `"HarperDB/status-check"`                            | GitHub shorthand                                 |
   | `"https://github.com/HarperDB/status-check"`         | GitHub URL                                       |
   | `"git+ssh://git@github.com:HarperDB/secret-app.git"` | Private repo via SSH                             |
   | `"https://example.com/application.tar.gz"`           | Tarball URL                                      |

   For git tags, use the `semver` directive:

   ```
   HarperDB/application-template#semver:v1.0.0
   ```

4. **Deploy by reference (optional)**: Instead of uploading a snapshot, send a pinned git reference so the cluster fetches and builds that exact commit. Use `by_ref=true` to resolve the current commit from the local repository automatically.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   Use `ref` to deploy a specific commit, tag, or branch (resolved to a full SHA before sending):

   ```bash
   # Deploy a specific tag
   harper deploy ref=v1.2.0 restart=true replicated=true

   # Roll back by deploying an older commit
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   **Key `by_ref` parameters:**

   | Parameter    | Required | Description                                                                                                                 |
   | ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------- |
   | `by_ref`     | —        | Build the package reference from the local repository                                                                       |
   | `ref`        | optional | Deploy a specific commit, tag, or branch instead of `HEAD`. Implies `by_ref`.                                               |
   | `credential` | optional | Set to `true` to authenticate the clone with the stored credential for the repository's host. Omit for public repositories. |

   > Commit and push before deploying by reference. The cluster clones from the remote and only sees pushed commits. Run `git fetch` if the unpushed-commit check fires for a commit you know you pushed.

5. **Authenticate for CI/CD**: Use environment variables instead of `harper login` for automated pipelines.

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

6. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source to provision a deploy credential. Run this with an administrative credential, not the CI identity.

   ```bash
   harper deploy setup=true
   ```

   Then pass `credential=true` on subsequent deploys:

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

7. **Use inline auth for one-off commands (not recommended for production)**: Pass `auth_username` and `auth_password` directly. These take precedence over environment variables and saved login tokens.

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

## Examples

**Standard deploy after login:**

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  package="@myorg/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy current directory as a snapshot:**

```bash
harper deploy \
  project=my-app \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy a pinned tag by reference:**

```bash
harper deploy ref=v1.2.0 restart=true replicated=true
```

**Deploy a private repository by reference with a stored credential:**

```bash
harper deploy by_ref=true credential=true restart=true replicated=true
```

**GitHub Actions — deploy the pull request head commit explicitly:**

```bash
harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
```

**CI/CD deploy using environment variables:**

```bash
export HARPER_CLI_USERNAME=<username>
export HARPER_CLI_PASSWORD=<password>
harper deploy \
  project=my-app \
  package="HarperDB/my-app#semver:v1.0.0" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

## Notes

- `harper login` stores an authentication token so subsequent `harper deploy` commands do not require credentials to be repeated.
- Inline `auth_username`/`auth_password` parameters take precedence over environment variables, which take precedence over saved login tokens.
- For SSH-based private repos, register keys with the `add_ssh_key` operation before deploying.
- `by_ref` deploys build from source on each cluster node. If your application requires a build step that cannot run on the node, deploy a built payload (omit `by_ref`) instead.
- `harper deploy setup=true` requires **super_user** privileges. Provision credentials with an administrative account, not the CI identity.
- Tags and branches passed to `ref` are resolved to a full commit SHA locally before the deploy is sent. If resolution fails, run `git fetch` and retry, or pass a full commit SHA directly.
- The `refs/pull/<n>/head` style refs are rejected; use `ref=${{ github.event.pull_request.head.sha }}` in GitHub Actions pull request workflows instead.
- Deploy credentials provisioned via `harper deploy setup=true` are stored scoped to the component and reused on every subsequent deploy, including rollbacks.
