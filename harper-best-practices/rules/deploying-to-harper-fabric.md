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
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: c821d15a19e2370f
---

# Deploying to Harper Fabric

Instructions for the agent to follow when deploying a Harper application to a remote Harper Fabric cloud cluster.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper instance or Fabric cluster, including first-time deploys, redeployments, rollbacks, and CI/CD pipeline deployments. Also apply it when provisioning credentials for private repository deploys. See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) for setting up the cluster before deploying.

## How It Works

1. **Authenticate against the remote cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on the cluster's **Config → Overview** page). The CLI stores the token and writes `HARPER_CLI_TARGET` to a local `.env`.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

2. **Deploy the application**: After login, run `harper deploy` without repeating credentials. Use `restart=true` and `replicated=true` for production deploys.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

3. **Choose a package source**: Set the `package` parameter to any valid npm dependency value. Options:

   | Source                  | Example value                                                |
   | ----------------------- | ------------------------------------------------------------ |
   | Current local directory | Omit `package`                                               |
   | npm package             | `package="@harperdb/status-check"`                           |
   | GitHub (shorthand)      | `package="HarperFast/status-check"`                          |
   | GitHub (URL)            | `package="https://github.com/HarperFast/status-check"`       |
   | Private repo (SSH)      | `package="git+ssh://git@github.com:HarperDB/secret-app.git"` |
   | Tarball                 | `package="https://example.com/application.tar.gz"`           |

   When using git tags, use the `semver` directive:

   ```
   HarperFast/application-template#semver:v1.0.0
   ```

4. **Deploy by reference (pinned commit)**: Use `by_ref=true` to send a pinned git reference instead of uploading a snapshot. The cluster fetches and builds from that exact commit SHA.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   - `by_ref` — Build the package reference from the local repository.
   - `ref` _(optional)_ — Deploy a specific commit, tag, or branch instead of `HEAD`. Implies `by_ref`. Tags and branches in `refs/tags` and `refs/heads` namespaces are resolved to a full commit SHA before the deploy is sent.
   - `credential` _(optional)_ — Set to `true` to authenticate the clone with the stored credential for the repository's host. Omit for public repositories.

   ```bash
   # Deploy a specific tag
   harper deploy ref=v1.2.0 restart=true replicated=true

   # Roll back by deploying an older commit
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   **Important constraints on refs:**
   - A full commit SHA is accepted directly with no resolution.
   - Every other `ref` must resolve to something a clone can fetch: `refs/tags/*` or `refs/heads/*`, or a bare branch or tag name.
   - Qualified refs outside those two namespaces (e.g., `refs/pull/123/head`) are rejected.
   - Commit and push before deploying — the cluster clones from the remote and only sees pushed commits.
   - Run `git fetch` if a ref can't be resolved, or pass a full commit SHA.

5. **Handle private repositories**: Pass `credential=true` so the CLI attaches a credentials reference that the cluster resolves in memory at clone time. No token travels in the operation body or lands on disk.

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

   Provision the credential once with `setup=true` before using `credential=true`.

6. **Provision a deploy credential**: Run `harper deploy setup=true` once per component and source to provision credentials for private deploys. This operation requires **super_user** — run it with an administrative credential, not the CI identity.

   ```bash
   harper deploy setup=true
   ```

   This interactive command:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope.
   3. Stores only the ciphertext with `set_secret`, in the component-scoped tier.
   4. Grants the component permission to resolve it with `grant_secret`.
   5. Prints the `credentials` reference for the deploy to use.

   **Use a fine-grained PAT** for GitHub repositories. The prompt defaults to a fine-grained personal access token with **Contents: Read-only** on that one repository. If you use the `gh` CLI session token instead, it typically carries `read:org`, `repo`, `gist`, and `workflow` scopes across your whole account — the CLI prints a warning if you choose it. Use the narrowest credential that does the job, because the stored token is replayed on every cold deploy and rollback.

7. **Use environment variables for CI/CD**: Instead of `harper login`, export credentials as environment variables.

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

8. **Use dedicated auth parameters for one-off commands** (not recommended for production): Pass `auth_username` and `auth_password` directly. These take precedence over environment variables and saved login tokens.

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
  package="HarperFast/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy by reference with a tag:**

```bash
harper deploy ref=v1.2.0 restart=true replicated=true
```

**Deploy a private GitHub repo by reference:**

```bash
# Provision credential once (requires super_user)
harper deploy setup=true

# Deploy using stored credential
harper deploy by_ref=true credential=true restart=true replicated=true
```

**GitHub Actions — pull request deploy:**

```bash
harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
```

**CI/CD deploy using environment variables:**

```bash
export HARPER_CLI_USERNAME=<username>
export HARPER_CLI_PASSWORD=<password>
harper deploy \
  project=my-app \
  package="@myorg/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

## Notes

- The cluster's Application URL is found on the **Config → Overview** page of the Fabric dashboard.
- `harper deploy setup=true` calls `get_secrets_public_key`, `set_secret`, and `grant_secret`, all of which require **super_user**. Do not run it with the CI identity.
- The `enc:v1:` envelope means the plaintext token never leaves your machine — only ciphertext is stored and replicated.
- Secrets are stored scoped to the component, not in the global `processEnv` tier. If a global secret already exists at the derived name, it is converted to the scoped tier.
- For SSH-based private repos, use the `add_ssh_key` operation to register keys before deploying.
- If your application requires a build step that cannot run on the cluster node, deploy a built payload (omit `by_ref`) instead of deploying by reference.
- The unpushed-commit check is skipped under GitHub Actions; the dirty-tree warning still applies.
- Annotated tags in `refs/tags` resolve to the commit they point at, not the tag object.
