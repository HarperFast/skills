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
  sourceCommit: fc17e9ddb92ad5a1ecc193e6017b680643a4a19b
  inputHash: 3e702cda43f56ddc
---

# Deploying to Harper Fabric

Instructions for the agent to deploy a Harper application to Harper Fabric using the CLI, verify certification, and roll back using a previous release's `deployment_id`.

**Instead of:** Docker Compose stacks; deploying several services separately. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, checking that a rolling deploy was certified on every node, or rolling back to a previous release by activating a stored `deployment_id`. See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) for cluster setup, and [deploying-from-ci.md](deploying-from-ci.md) for GitHub Actions workflows.

## How It Works

1. **Log in to the cluster once**: Pass the cluster's **Application URL**, from its **Config → Overview** page, to `harper login`. The CLI stores the token, so later commands don't repeat credentials. If the current directory already has a `.env` file that sets no target, the CLI also appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   For CI/CD pipelines, use workload identity (OIDC) or a refresh token from `harper login --for-ci` instead of a password. See [deploying-from-ci.md](deploying-from-ci.md) for a complete GitHub Actions workflow. For a one-off command, `auth_username=` and `auth_password=` are also available as dedicated parameters (not recommended for production).

2. **Deploy the application**: Run `harper deploy` with the required parameters. A bare `target` host defaults to `https://<host>:9925`. Use `restart=rolling` for a staggered, zero-downtime restart across the cluster. Pass `replicated=false` to deploy only to the node you called. Pass `json=true` to print the result as JSON.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=rolling \
     replicated=true
   ```

3. **Choose a package source**: The `package` parameter accepts any valid npm dependency value.

   | Format             | Example                                                                                       |
   | ------------------ | --------------------------------------------------------------------------------------------- |
   | Current directory  | Omit `package`                                                                                |
   | npm package        | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)    | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH) | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball            | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

4. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source. (With `provider=github-actions`, it sets up GitHub Actions OIDC deploys instead.) This requires `super_user` privileges and is interactive:

   ```bash
   harper deploy setup=true
   ```

   This flow:
   - Fetches the cluster's public key with `get_secrets_public_key`.
   - Encrypts the token locally into an `enc:v1:` envelope.
   - Stores only the ciphertext with `set_secret`, scoped to the component, never in the global `processEnv` tier.
   - Grants the component permission to resolve it with `grant_secret`.

   Prefer a `fine-grained` PAT with **Contents: Read-only** on that one repository. Avoid the `gh` CLI session token, which typically carries `read:org`, `gist`, and `workflow` scopes across your whole account.

   Then deploy using the sealed credential:

   ```bash
   harper deploy by_ref=true credential=true restart=rolling replicated=true
   ```

5. **Stage a release to make live later**: `activate=false` (`activate: false` in the operation) builds and installs the release on each node without making it live, so the slow, fallible part happens when you choose and the cut-over is quick. Cannot be combined with `restart`.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"package": "npm:@my-org/my-app@1.2.3",
   	"activate": false
   }
   ```

   The response includes a `deployment_id` naming the staged artifact. Staged builds and replaced releases together count against `deployment.stagingRetention.maxCount` (default `5`). Each kept release is a full installed copy of the component, `node_modules` included, so budget disk for it. `0` keeps no replaced release. `file:` directory sources (`package: file:<dir>`) cannot be staged and are not kept as rollback targets.

6. **Activate a staged build**: Make a staged build live using its `deployment_id`. Pass `restart` here, not on the stage step. Takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — those are rejected rather than ignored.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "a3f8c2d1-...",
   	"restart": true
   }
   ```

   - A `404` response means the id never existed on that node, was pruned, or the release was replaced and not kept. A `409` means the build exists but cannot be activated (e.g., belongs to another component, or files changed after staging).
   - Activating the release that is already live succeeds and changes nothing — retries are safe.

7. **Deploy by reference for a reproducible source**: `by_ref=true` sends a pinned git reference instead of uploading the working directory, and the cluster fetches and builds that exact commit. It resolves the repository's `origin` remote and the current commit, then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`.

   ```bash
   harper deploy by_ref=true restart=rolling replicated=true
   ```

   Deploy a specific tag or commit with `ref`:

   ```bash
   harper deploy ref=v1.2.0 restart=rolling replicated=true
   harper deploy ref=9f8c2a1 restart=rolling replicated=true
   ```

   - Tags and branches are resolved to a full commit SHA before the deploy is sent. A `ref` that cannot be resolved stops the deploy — run `git fetch` and retry, or pass a full commit SHA.
   - Any other `ref` must name something a clone can fetch: `refs/heads/*` or `refs/tags/*`, or a bare branch or tag name. A qualified ref outside those, such as `refs/pull/123/head`, is rejected up front.
   - Commit and push before deploying — the cluster clones from the remote and only sees pushed commits.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly.

8. **Roll back to a previous release**: Use `list_deployments` to find the `deployment_id` of the release to restore, then activate it with `restart`. This swaps in the exact installed release with no fetch, rebuild, or reinstall.

   ```bash
   harper deploy project=<name> deployment_id=<id> restart=true
   ```

   The release it replaces is kept in turn, so you can go forward again the same way.

9. **Wait for a rolling deploy to finish**: A `deploy_component` with `"restart": "rolling"` returns a `restartJobId`. Poll it with `get_job` to learn whether every node took the release.

   ```json
   { "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
   ```

   `get_job` returns status `COMPLETE`, `IN_PROGRESS`, or `ERROR`. It answers only on the node that ran the job — any other node returns an empty array.

10. **Check certification after a rolling deploy**: A deploy with `restart=rolling` certifies the release on each node using a canary worker before rolling it out. The response includes a `certification` field:

    | `certification` | Meaning                                                                                                                                                                         |
    | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `certified`     | The canary loaded the release; rollout proceeded.                                                                                                                               |
    | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced. |
    | `unavailable`   | Deploy restarted unchecked (no worker loads the component, `isolated` setting changed, already live, or `package: file:<dir>` source).                                          |
    | `not-requested` | The deploy did not restart.                                                                                                                                                     |
    - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. The error carries `certification` as an object with `status` set to `rejected`, or `interrupted` for a restart that stopped before the canary decided.
    - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed and says why. Deploy a fixed release, or activate the same `deployment_id` again with `restart` once the cause is fixed.
    - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.
    - A rolling deploy's record reads `rolling_out` until the job has visited every node; filter `list_deployments` without `status` and check each record's `status` for a finished value (`success`, `partial`, `failed`, `staged`). `completed_at` alone does not confirm a finished state.
    - `list_deployments` returns records newest first. Filter by `project` and `status`; omit `limit` to return every matching record. A deploy in progress reads `pending`, or `loading`, until its `completed_at` is set.

## Examples

### Standard rolling deploy to a cluster

```bash
# Authenticate once
harper login https://my-cluster.harperdbcloud.com

# Deploy with rolling restart
harper deploy \
  project=my-app \
  package="HarperFast/my-app#semver:v2.1.0" \
  target=https://my-cluster.harperdbcloud.com \
  restart=rolling \
  replicated=true
```

### Deploy by reference with a private repo

```bash
# Provision credential once (requires super_user)
harper deploy setup=true

# Deploy pinned to current HEAD, authenticating the clone
harper deploy \
  by_ref=true \
  credential=true \
  restart=rolling \
  replicated=true
```

### Stage a build, then activate in a maintenance window

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

Activate later:

```json
{
	"operation": "deploy_component",
	"project": "my-app",
	"deployment_id": "a3f8c2d1-...",
	"restart": true
}
```

### Roll back using list_deployments

```json
{ "operation": "list_deployments", "project": "my-app", "status": "success", "limit": 20 }
```

Then activate the target release:

```json
{
	"operation": "deploy_component",
	"project": "my-app",
	"deployment_id": "<id of the deployment you want back>",
	"restart": true
}
```

### Check rolling deploy job status

```json
{ "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
```

Returns `COMPLETE`, `IN_PROGRESS`, or `ERROR`. The `restartJobId` from the deploy response is the id to query.

### Certification rejection response

```json
{
	"error": "my-app was not deployed: release 9b2e... failed to load in its canary worker: my-app.jsResource: ... Deployment a3f8c2d1..., the release it replaced, is live again. No other node received it. Deploy a fix, or activate deployment 9b2e... again once the cause is fixed.",
	"deployment_id": "9b2e...",
	"certification": {
		"status": "rejected",
		"reason": "my-app.jsResource: ...",
		"failures": [
			{ "key": "my-app.jsResource", "name": "ResourceLoadError", "message": "...", "stack": "..." }
		],
		"restored": "a3f8c2d1...",
		"failed_closed": false
	}
}
```

## Notes

- `harper login` stores a token; use `harper login --for-ci` to get a refresh token for non-OIDC pipelines. See [deploying-from-ci.md](deploying-from-ci.md) for GitHub Actions OIDC setup.
- `replicated=false` deploys to the called node only. On Harper Pro and Fabric, omitting this deploys to every node.
- `restart=rolling` cannot be combined with `activate=false`.
- `deployment_id` activation takes no build inputs — passing `package`, `by_ref`, or install options is rejected.
- `deployment.stagingRetention.maxCount` (default `5`) caps staged builds and kept replaced releases together per component. Oldest are pruned at the next deploy or startup.
- `file:` directory sources (`package: file:<dir>`) cannot be staged or kept for rollback.
- `get_job` on a `restartJobId` answers only on the node that received the deploy; any other node returns an empty array.
- A deploy-only role that waits for rolling deploys must include `get_job` (and `get_deployment` for certified rolling deploys) in its `operations` allowlist.
- The `enc:v1:` envelope is the only form of the token that ever leaves your machine or travels over the operations API — the plaintext never does.
- `super_user` is required to run `harper deploy setup=true`.
- `not-requested` in `certification` means the deploy completed without a restart; no canary check was performed.
- A rejected release with no previous release to restore **fails closed**: no worker loads it, even after Harper restarts.
