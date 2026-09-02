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
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: e5586ad2bcc7c12a
---

# Deploying to Harper Fabric

Instructions for the agent to follow when deploying a Harper application to a remote Harper Fabric cloud cluster.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster or any remote Harper instance. This includes first-time deploys, redeployments, rollbacks, CI/CD pipeline deploys, and provisioning credentials for private repositories. See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) for setting up the cluster before deploying.

## How It Works

1. **Authenticate against the remote cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on the cluster's **Config → Overview** page). The CLI stores the token and writes `HARPER_CLI_TARGET` to a local `.env`.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

2. **Deploy the application**: After login, run `harper deploy` without repeating credentials. Set `restart=true` and `replicated=true` for a production deploy.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

3. **Use environment variables for CI/CD**: Instead of `harper login`, export credentials as environment variables before calling `harper deploy`.

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

4. **Choose a package source**: The `package` field accepts any valid npm dependency value. Select the form that matches your source:

   | Source                  | `package` value                                      |
   | ----------------------- | ---------------------------------------------------- |
   | Current local directory | Omit `package`                                       |
   | npm package             | `"@harperdb/status-check"`                           |
   | GitHub (public)         | `"HarperFast/status-check"` or full URL              |
   | Private repo (SSH)      | `"git+ssh://git@github.com:HarperDB/secret-app.git"` |
   | Tarball                 | `"https://example.com/application.tar.gz"`           |

   For git tags, use the `semver` directive:

   ```
   HarperFast/application-template#semver:v1.0.0
   ```

5. **Deploy by reference for reproducible deploys**: Pass `by_ref=true` to send a pinned git SHA instead of uploading a snapshot. The cluster fetches and builds from that exact commit.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   Use `ref` to target a specific commit, tag, or branch (resolved to a full SHA before sending):

   ```bash
   # Deploy a specific tag
   harper deploy ref=v1.2.0 restart=true replicated=true

   # Roll back by deploying an older commit
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   **Key constraints for `ref` values:**
   - Must name something a clone can fetch: `refs/heads/*` and `refs/tags/*`, or a bare branch or tag name.
   - Anything else (e.g., `refs/pull/123/head`) is rejected up front.
   - If a ref can't be resolved, the deploy stops — run `git fetch` and retry, or pass a full commit SHA.
   - Commit and push before deploying: the cluster clones from the remote and only sees pushed commits.

6. **Deploy private repositories by reference**: Pass `credential=true` alongside `by_ref=true`. The CLI attaches a credentials reference; the cluster resolves the secret in memory at clone time — no token travels in the operation body or lands on disk.

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

7. **Provision a deploy credential for private sources**: Run `harper deploy setup=true` once per component and source. This is interactive and requires **super_user** — run it with an administrative credential, not the CI identity.

   ```bash
   harper deploy setup=true
   ```

   This command:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope.
   3. Stores only the ciphertext with `set_secret`, in the component-scoped tier.
   4. Grants the component permission to resolve it with `grant_secret`.
   5. Prints the `credentials` reference for the deploy to use.

   Use a **fine-grained** personal access token (PAT) scoped to **Contents: Read-only** on the specific repository. Avoid session tokens from `gh` CLI — they typically carry `repo`, `read:org`, `gist`, and `workflow` scopes across your whole account.

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
  package="HarperFast/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy by reference in GitHub Actions (pull request):**

```bash
harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
```

**Deploy a private repo by reference with a provisioned credential:**

```bash
# Provision once (run as super_user)
harper deploy setup=true

# Deploy subsequently
harper deploy by_ref=true credential=true restart=true replicated=true
```

## Notes

- `auth_username` and `auth_password` can be passed directly as deploy parameters for one-off commands, but this is not recommended for production. Dedicated authentication parameters take precedence over environment variables and saved login tokens.
- The `enc:v1:` envelope means the plaintext token never leaves your machine — only ciphertext is stored and replicated.
- Deploy credentials are stored scoped to the component, never in the global `processEnv` tier. If a global secret exists at the derived name, it is converted to the component-scoped tier automatically.
- Because stored credentials are durable, later deploys and rollbacks reuse them without re-entering anything.
- The unpushed-commit check is skipped under GitHub Actions; the dirty-tree warning still applies.
- Deploying by reference means the cluster installs and builds from source. If your application requires a build step that cannot run on the node, deploy the built output as a payload deploy instead.
- For SSH-based private repos, use the `add_ssh_key` operation to register keys before deploying.
