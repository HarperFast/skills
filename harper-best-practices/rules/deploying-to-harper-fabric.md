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
  sourceCommit: e73e5efb2823cc52caf7a6458d67fbcff3bbff2c
  inputHash: dc9d96d6393de8f7
---

# Deploying to Harper Fabric

Instructions for the agent to follow when deploying a Harper application to a remote Harper Fabric cloud cluster.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, whether from a local machine or a CI/CD pipeline. Use it to configure authentication, select a package source, and run `harper deploy` with the correct parameters.

See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) to set up a cluster before deploying.

## How It Works

1. **Authenticate against the cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on the cluster's **Config → Overview** page). The CLI stores the token so subsequent commands need no credentials. If the current directory already has a `.env` file that sets no target, it also appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

2. **Deploy the application**: After logging in, run `harper deploy` without repeating credentials. Omit `package` to package and deploy the current local directory.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

3. **Choose a package source**: Set `package` to any valid npm dependency value.

   | Value                                                        | Meaning                                        |
   | ------------------------------------------------------------ | ---------------------------------------------- |
   | _(omit)_                                                     | Package and deploy the current local directory |
   | `package="@harperdb/status-check"`                           | npm package                                    |
   | `package="HarperFast/status-check"`                          | GitHub shorthand                               |
   | `package="https://github.com/HarperFast/status-check"`       | GitHub URL                                     |
   | `package="git+ssh://git@github.com:HarperDB/secret-app.git"` | Private repo (SSH)                             |
   | `package="https://example.com/application.tar.gz"`           | Tarball                                        |

   When using git tags, use the `semver` directive:

   ```
   HarperFast/application-template#semver:v1.0.0
   ```

4. **Deploy by reference** (pinned commit): Use `by_ref=true` to send a pinned git reference instead of uploading a snapshot. The cluster fetches and builds that exact commit.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   - `by_ref` — Build the package reference from the local repository.
   - `ref` _(optional)_ — Deploy a specific commit, tag, or branch instead of `HEAD`. Implies `by_ref`. Resolved to a full commit SHA before being sent.
   - `credential` _(optional)_ — Set to `true` to authenticate the clone with the stored credential for the repository's host. Omit for public repositories.

   Deploy a specific tag or commit:

   ```bash
   harper deploy ref=v1.2.0 restart=true replicated=true
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   Valid `ref` values must resolve to `refs/heads/*` or `refs/tags/*`, or a bare branch or tag name. Qualified refs outside those two namespaces (e.g. `refs/pull/123/head`) are rejected. A full commit SHA is always accepted directly with no resolution attempted. Run `git fetch` if a ref can't be resolved, or pass a full commit SHA.

   **Commit and push before deploying by reference.** The cluster clones from the remote and only sees pushed commits.

5. **Roll back to a previous release**: Activate a kept release by its `deployment_id` to restore the exact installed release without a fetch, rebuild, or reinstall.

   ```bash
   harper deploy project=<name> deployment_id=<id> restart=true
   ```

6. **Provision a deploy credential for private repositories**: Run `harper deploy setup=true` once per component and source. This requires **super_user** privileges — run it with an administrative credential.

   ```bash
   harper deploy setup=true
   ```

   The setup flow:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope.
   3. Stores only the ciphertext with `set_secret`, scoped to the component.
   4. Grants the component permission to resolve it with `grant_secret`.
   5. Prints the `credentials` reference for the deploy to use.

   The plaintext never leaves your machine. Prefer a **fine-grained** personal access token with **Contents: Read-only** on the target repository. Avoid broad session tokens — they typically carry `read:org`, `gist`, and `workflow` scopes across your whole account.

7. **Deploy from a private repository**: Pass `credential=true` after provisioning the deploy credential.

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

8. **Use one-off authentication parameters** (not recommended for production): Pass `auth_username` and `auth_password` directly. These take precedence over environment variables and saved login tokens.

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

9. **Use CI/CD pipelines**: For GitHub Actions, use workload identity (OIDC) so no Harper credential is stored in the pipeline. Alternatively, supply a refresh token from `harper login --for-ci`. On a `pull_request` run, pass the head SHA explicitly:

   ```bash
   harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
   ```

## Examples

**Login and deploy the current directory to a remote cluster:**

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy a specific GitHub repository by tag:**

```bash
harper deploy \
  project=my-app \
  package="HarperFast/application-template#semver:v1.0.0" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy by reference from a private repository after provisioning credentials:**

```bash
# Provision once (requires super_user)
harper deploy setup=true

# Deploy by reference with credential
harper deploy by_ref=true credential=true restart=true replicated=true
```

**Roll back to a previous deployment:**

```bash
harper deploy project=my-app deployment_id=<id> restart=true
```

## Notes

- The cluster's Application URL is found on the **Config → Overview** page.
- `harper deploy setup=true` requires **super_user** — run it with an administrative credential, not the CI identity it provisions for.
- Secrets are stored scoped to the component, never in the global `processEnv` tier. The `enc:v1:` envelope is the only form of the token that ever leaves your machine or travels over the operations API.
- For SSH-based private repos, use the `add_ssh_key` operation to register keys before deploying.
- A `ref` pointing to `refs/tags` is resolved to a full commit SHA before the deploy is sent. Tags that move mid-deploy could otherwise leave cluster nodes running different code.
- The unpushed-commit check is skipped under GitHub Actions; the dirty-tree warning still applies.
- Deploying by reference means the cluster installs and builds from source. If your application requires a build step that cannot run on the node, deploy a built payload instead.
