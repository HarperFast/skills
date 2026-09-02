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
  sourceCommit: 0d151a2c1f8d3988aef4dc6fc7deaa3e13f13589
  inputHash: c821d15a19e2370f
---

# Deploying to Harper Fabric

Instructions for the agent to follow when deploying a Harper application to a remote Harper Fabric cloud cluster.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper instance or Fabric cluster, including first-time deploys, redeployments, rollbacks, and CI/CD pipeline deployments. Also apply it when provisioning credentials for private repository deploys. See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) for setting up the target cluster first.

## How It Works

1. **Authenticate against the remote cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on the cluster's **Config → Overview** page). The CLI stores the token and writes `HARPER_CLI_TARGET` to a local `.env`.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

2. **Deploy the application**: After login, run `harper deploy` without repeating credentials. Use `restart=true` to restart after deploy and `replicated=true` to propagate across all cluster nodes.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

3. **Choose a package source**: Set the `package` parameter to any valid npm dependency value. Omit `package` entirely to package and upload the current local directory.

   | Value                  | Example                                                      |
   | ---------------------- | ------------------------------------------------------------ |
   | Omit (local directory) | _(no `package` param)_                                       |
   | npm package            | `package="@harperdb/status-check"`                           |
   | GitHub                 | `package="HarperFast/status-check"`                          |
   | GitHub URL             | `package="https://github.com/HarperFast/status-check"`       |
   | Private repo (SSH)     | `package="git+ssh://git@github.com:HarperDB/secret-app.git"` |
   | Tarball                | `package="https://example.com/application.tar.gz"`           |

   When using git tags, use the `semver` directive:

   ```
   HarperFast/application-template#semver:v1.0.0
   ```

4. **Deploy by reference (pinned commit)**: Use `by_ref=true` to send a pinned git reference instead of uploading a snapshot. The cluster fetches and builds from that exact commit SHA. Commit and push your changes before running this.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   - `by_ref` — resolves the local repo's `origin` remote and current `HEAD` commit SHA, then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`.
   - `ref` _(optional)_ — deploy a specific commit, tag, or branch instead of `HEAD`. Implies `by_ref`. Tags and branches are resolved to a full commit SHA before the deploy is sent. Only `refs/heads/*` and `refs/tags/*` namespaces are accepted; qualified refs outside those (e.g. `refs/pull/123/head`) are rejected.
   - `credential` _(optional)_ — set to `true` to authenticate the clone with the stored credential for the repository's host. Omit for public repositories.

   ```bash
   # Deploy a specific tag
   harper deploy ref=v1.2.0 restart=true replicated=true

   # Roll back by deploying an older commit
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

5. **Authenticate for CI/CD via environment variables**: For pipelines, set credentials as environment variables instead of using `harper login`.

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

6. **Provision a deploy credential for private repositories**: Run `harper deploy setup=true` once per component and source. This requires **super_user** privileges — run it with an administrative credential, not the CI identity. It is interactive and calls `get_secrets_public_key`, `set_secret`, and `grant_secret`.

   ```bash
   harper deploy setup=true
   ```

   The provisioning flow:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope.
   3. Stores only the ciphertext with `set_secret`, scoped to the component.
   4. Grants the component permission to resolve it with `grant_secret`.
   5. Prints the `credentials` reference for the deploy to use.

   The plaintext never leaves your machine. Once provisioned, subsequent deploys and rollbacks reuse the stored credential without re-entering anything.

7. **Use a fine-grained PAT for GitHub private repos**: When `setup=true` prompts for a GitHub token, prefer a **fine-grained** personal access token scoped to **Contents: Read-only** on that one repository. The `gh` CLI session token is also offered but typically carries `repo`, `read:org`, `gist`, and `workflow` scopes across your whole account — choosing it prints a warning. Use the narrowest credential that does the job, because it is replayed on every cold deploy and rollback.

8. **Deploy a private repository by reference**: Pass `credential=true` so the CLI attaches a credentials reference that the cluster resolves in memory at clone time.
   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

## Examples

**Standard deploy after login:**

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  package="HarperFast/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**CI/CD deploy using environment variables:**

```bash
export HARPER_CLI_USERNAME=admin
export HARPER_CLI_PASSWORD=secret
harper deploy \
  project=my-app \
  package="@myorg/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy by reference with a tag:**

```bash
harper deploy ref=v1.2.0 restart=true replicated=true
```

**Deploy a private repo by reference with a stored credential:**

```bash
harper deploy by_ref=true credential=true restart=true replicated=true
```

**GitHub Actions — deploy the PR head commit explicitly:**

```bash
harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
```

**Provision a deploy credential (run once, as admin):**

```bash
harper deploy setup=true
```

## Notes

- `by_ref` warns when the working tree is dirty or when the commit being deployed is not on any remote branch. Run `git fetch` and retry if you get an unexpected warning, or pass a full commit SHA directly.
- The unpushed-commit check is skipped under GitHub Actions; the dirty-tree warning still applies.
- On a `pull_request` GitHub Actions run, `by_ref` uses the pull request's head commit (not the merge commit), because the merge commit lives under `refs/pull/<n>/merge` which a plain clone cannot fetch.
- A full commit SHA requires no resolution and is always accepted directly.
- The deploy credential secret is stored scoped to the component, never in the global `processEnv` tier. Secrets custody requires Harper Pro / Fabric.
- For SSH-based private repos, use the `add_ssh_key` operation to register keys before deploying.
- Dedicated `auth_username` / `auth_password` parameters are available for one-off commands but are not recommended for production; they take precedence over environment variables and saved login tokens.
