---
name: deploying-to-harper-fabric
description: >-
  How to deploy a Harper application to Harper Fabric with the CLI, check that
  the release was certified, and roll back by activating a previous release's
  `deployment_id`.
metadata:
  mode: generate
  sources:
    - reference/v5/components/applications.md#Remote Management
    - >-
      fabric/cluster-creation-management.md#Connecting the Harper CLI to a
      Cluster
    - reference/v5/cli/commands.md#Parameters
    - reference/v5/cli/operations-api-commands.md#General Syntax
    - >-
      reference/v5/operations-api/operations.md#Certifying a release in a canary
      worker
    - >-
      reference/v5/operations-api/operations.md#Staging a build and activating
      it later
    - reference/v5/operations-api/operations.md#Going back to a previous release
    - reference/v5/operations-api/operations.md#Retrying an activation
    - reference/v5/operations-api/operations.md#`list_deployments`
    - reference/v5/operations-api/operations.md#`get_job`
  sourceCommit: 6a3973e6ac8c5b4607c3f464c7e1965b16b34342
  inputHash: 5f930bb9eee981dc
---

# Deploying to Harper Fabric

Instructions for the agent to deploy a Harper application to Harper Fabric using the CLI, verify release certification, and roll back using a previous release's `deployment_id`.

**Instead of:** Docker Compose stacks; deploying several services separately. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, checking whether a rolling deploy was certified on each node, or restoring a previous release without rebuilding. Also apply it when provisioning credentials for private-source deploys or staging a build for later activation.

## How It Works

1. **Log in to the cluster once**: Pass the cluster's **Application URL**, from its **Config → Overview** page, to `harper login`. The CLI stores the token, so later commands don't repeat credentials. If the current directory already has a `.env` file that sets no target, the CLI also appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   For CI/CD pipelines, use workload identity (OIDC) or a refresh token from `harper login --for-ci` instead of a password. See [deploying-from-ci.md](deploying-from-ci.md) for a complete GitHub Actions workflow. For a one-off command, `auth_username=` and `auth_password=` are also available as dedicated parameters (not recommended for production); they take precedence over environment variables and saved login tokens.

2. **Deploy the application**: Run `harper deploy` with the required parameters. A bare `target` host defaults to `https://<host>:9925`. Use `restart=rolling` for a staggered, zero-downtime restart across the cluster. Pass `replicated=false` to deploy to the single node you called only. Pass `json=true` to print output as JSON instead of the default YAML.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

   For a rolling cluster restart (one node at a time, each node stays in rotation while restarting):

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=rolling \
     replicated=true
   ```

3. **Choose a package source**: The `package` field accepts any valid npm dependency value. Omit it to upload the current local directory.

   | Source             | Example                                                                                       |
   | ------------------ | --------------------------------------------------------------------------------------------- |
   | npm package        | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)    | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH) | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball            | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

4. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source. (With `provider=github-actions`, it sets up GitHub Actions OIDC deploys instead.) This requires `super_user` privileges and is interactive. The command:
   - Fetches the cluster's public key with `get_secrets_public_key`.
   - Encrypts the token locally into an `enc:v1:` envelope.
   - Stores only the ciphertext with `set_secret` in the component-scoped tier.
   - Grants the component permission to resolve it with `grant_secret`.

   ```bash
   harper deploy setup=true
   ```

   Use a `fine-grained` personal access token scoped to **Contents: Read-only** on the target repository. Avoid broad tokens: the GitHub CLI session token typically carries `read:org`, `gist`, `workflow`, and `repo` scopes across your whole account. The sealed credential is durable and reused on every cold deploy and rollback.
   - The `enc:v1:` envelope for sealed credentials is stored scoped to the component, never in the global `processEnv` tier. Requires Harper Pro or Fabric for secrets custody.

5. **Deploy by reference for a reproducible source**: `by_ref=true` sends a pinned git reference instead of uploading the working directory, and the cluster fetches and builds that exact commit. It resolves the repository's `origin` remote and the current commit, then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   # Deploy a specific tag or commit:
   harper deploy ref=v1.2.0 restart=true replicated=true
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   - Tags and branches are resolved to a full commit SHA before the deploy is sent. A `ref` that cannot be resolved stops the deploy — run `git fetch` and retry, or pass a full commit SHA. A full commit SHA is accepted directly with no resolution attempted.
   - Any other `ref` must name something a clone can fetch: `refs/heads/*` or `refs/tags/*`, or a bare branch or tag name. A qualified ref outside those, such as `refs/pull/123/head`, is rejected up front.
   - Commit and push before deploying — the cluster clones from the `origin` remote and only sees pushed commits.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly:

   ```bash
   harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
   ```

   For private repositories, pass `credential=true` (provision first with `harper deploy setup=true`):

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

6. **Activate a staged build**: Make a staged build live using its `deployment_id`. Pass `restart` here, not on the stage step. Takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — those are rejected rather than ignored, because the staged build already decided them.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "a3f8c2d1-..."
   }
   ```

7. **Roll back to a previous release**: Use `list_deployments` to find each deployment's id, then activate the previous release's `deployment_id` with no rebuild or reinstall.

   ```json
   {
   	"operation": "list_deployments",
   	"project": "my-app",
   	"status": "success",
   	"limit": 20
   }
   ```

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "<id of the deployment you want back>",
   	"restart": true
   }
   ```

   Or via the CLI:

   ```bash
   harper deploy project=<name> deployment_id=<id> restart=true
   ```

8. **Stage a build for later activation**: Pass `activate=false` (`activate: false` in the operation) to build and install without making the release live. `activate: false` cannot be combined with `restart`.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"package": "npm:@my-org/my-app@1.2.3",
   	"activate": false
   }
   ```

   Response:

   ```json
   {
   	"deployment_id": "a3f8c2d1-...",
   	"message": "Staged: my-app. Deploy it with deploy_component deployment_id=a3f8c2d1-..."
   }
   ```

   The response includes a `deployment_id` naming the staged artifact. Staged builds and replaced releases together count against `deployment.stagingRetention.maxCount` (default `5`). Each kept release is a full installed copy of the component, `node_modules` included. The oldest are pruned at the next deploy or startup.

9. **Wait for a rolling deploy to finish**: A `deploy_component` with `"restart": "rolling"` returns a `restartJobId`. Poll it with `get_job` to learn whether every node took the release.

   ```json
   { "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
   ```

   `get_job` returns status `COMPLETE`, `IN_PROGRESS`, or `ERROR`. It answers only on the node that ran the job — `system.hdb_job` is not replicated. For a rolling deploy, that is the node that received the deploy. A deploy-only role that polls rolling deploys must include both `get_job` and `get_deployment` in its `operations` allowlist.

10. **Check release certification**: Every deploy with `restart=true` or `restart=rolling` runs a canary worker that loads the new release before rolling it out. The deploy response includes a `certification` field:

    | `certification` | Meaning                                                                                                                                                                         |
    | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `certified`     | Canary loaded the release; rollout proceeded.                                                                                                                                   |
    | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced. |
    | `unavailable`   | Deploy restarted unchecked (no worker loads the component, `isolated` setting changed, already live, or `package: file:<dir>` source).                                          |
    | `not-requested` | The deploy did not restart.                                                                                                                                                     |
    - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. A restart that stops before the canary decides reports `status: "interrupted"`.
    - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed and says why. Deploy a fixed release, or activate the same `deployment_id` again with `restart` once the cause is fixed.
    - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.
    - A `404` response means the id never existed on that node, was pruned, or the release was replaced and not kept. A `409` means the build exists but cannot be activated (e.g., belongs to another component, or files changed after staging).

11. **Monitor `list_deployments` correctly**: A deploy in progress reads `pending`, or `loading` once its release has started loading. A rolling deploy's record reads `rolling_out` until the job has visited every node; filter `list_deployments` without `status` and check each record's `status` for a finished value (`success`, `partial`, `failed`, `staged`). `completed_at` alone does not indicate a finished record, since a `rolling_out` record already has it.

## Examples

### Full deploy to a remote cluster with rolling restart

```bash
# Authenticate once
harper login https://my-cluster.harperdbcloud.com

# Deploy with rolling restart
harper deploy \
  project=my-app \
  package="HarperFast/application-template#semver:v1.0.0" \
  target=https://my-cluster.harperdbcloud.com \
  restart=rolling \
  replicated=true
```

### Deploy by reference with a semver tag

```bash
harper deploy ref=v1.2.0 restart=true replicated=true
```

### Stage a build, then activate it

```bash
# Stage without activating
harper deploy \
  project=my-app \
  package="npm:@my-org/my-app@1.2.3" \
  activate=false \
  replicated=true

# Later: activate by deployment_id
harper deploy project=my-app deployment_id=a3f8c2d1-... restart=true
```

### Roll back to a previous release

```json
{ "operation": "list_deployments", "project": "my-app" }
```

```bash
harper deploy project=my-app deployment_id=<previous-id> restart=true
```

### Check rolling deploy job status

```json
{ "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
```

Response ends with `COMPLETE` on success or `ERROR` with node-level detail on partial failure.

## Notes

- `restart=rolling` restarts nodes one at a time. With `wait=false`, the CLI exits once the receiving node has taken the release. `wait_timeout=<ms>` caps how long to wait for other nodes (default: ten minutes per node).
- `activate=false` cannot be combined with `restart`. Pass `restart` on the activation step (`deployment_id`) instead.
- `deployment_id` activations accept no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — these are rejected, not ignored.
- Activating the release that is already live succeeds without a swap, making retries safe.
- `file:` directory sources cannot be staged (`activate=false`) and are not kept as rollback targets.
- The `stagingRetention` cap (`deployment.stagingRetention.maxCount`, default `5`) applies to staged builds and replaced releases together. Pruned builds must be staged again.
- `super_user` is required to run `harper deploy setup=true`.
- `refs/heads/*` and `refs/tags/*` are the only accepted qualified ref namespaces for `by_ref` deploys.
- For CI/CD without stored credentials, see [deploying-from-ci.md](deploying-from-ci.md). For cluster setup, see [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md).
