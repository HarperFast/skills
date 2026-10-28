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
  sourceCommit: e69702c99845f2dd810cb32652d1a9e6b58c538b
  inputHash: 44ee050eac4a5056
---

# Deploying to Harper Fabric

Instructions for the agent to deploy a Harper application to Harper Fabric using the CLI, verify certification, and roll back using a previous release's `deployment_id`.

**Instead of:** Docker Compose stacks; deploying several services separately. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, checking whether a rolling deploy was certified on each node, or restoring a previous release without rebuilding. Also apply it when provisioning credentials for private-source deploys or staging a build for later activation.

## How It Works

1. **Log in to the cluster once**: Pass the cluster's **Application URL**, from its **Config → Overview** page, to `harper login`. The CLI stores the token, so later commands don't repeat credentials. If the current directory already has a `.env` file that sets no target, it also appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   For CI/CD pipelines, use workload identity (OIDC) or a refresh token from `harper login --for-ci` instead of a password. See [deploying-from-ci.md](deploying-from-ci.md) for a complete GitHub Actions workflow. For a one-off command, `auth_username=` and `auth_password=` also work, and take precedence over environment variables and saved login tokens. Don't use them in production.

2. **Deploy the application**: Run `harper deploy` with the required parameters. Omit `package` to upload the current directory; supply a reference for npm, GitHub, or tarball sources.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

   A bare `target` host defaults to `https://<host>:9925`. Use `restart=rolling` for a staggered, zero-downtime restart across the cluster. Pass `replicated=false` to deploy only to the node you called. Pass `json=true` to print the result as JSON instead of YAML.

3. **Choose a package source**: The `package` field accepts any valid npm dependency value.

   | Source             | Value                                                                                         |
   | ------------------ | --------------------------------------------------------------------------------------------- |
   | npm package        | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)    | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH) | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball            | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

4. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source. (With `provider=github-actions`, it sets up GitHub Actions OIDC deploys instead.) This requires `super_user` privileges and is interactive. It calls `get_secrets_public_key`, `set_secret`, and `grant_secret`. Run it with an administrative credential rather than the CI identity it provisions for:

   ```bash
   harper deploy setup=true
   ```

   The command:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope.
   3. Stores only the ciphertext with `set_secret`, scoped to the component, never in the global `processEnv` tier.
   4. Grants the component permission to resolve it with `grant_secret`.

   Use a **fine-grained** personal access token with **Contents: Read-only** on the target repository. Avoid broad tokens: the `gh` CLI session token typically carries `read:org`, `gist`, and `workflow` scopes across your whole account. Then deploy with `credential=true`:

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
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

   The response names the artifact waiting to be activated:

   ```json
   {
   	"deployment_id": "a3f8c2d1-...",
   	"message": "Staged: my-app. Deploy it with deploy_component deployment_id=a3f8c2d1-..."
   }
   ```

   Nothing about the running component changes, and `get_deployment` reports it as `staged`. Make it live by deploying that `deployment_id`, as in step 6. The activation takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host`. They are rejected, because the staged build already decided them.

6. **Activate a staged build or roll back**: Pass `deployment_id` with `restart` to make a staged build live, or to restore a release a later deploy replaced, with no rebuild or reinstall. Pass `restart` here rather than on the stage.

   ```bash
   harper deploy project=<name> deployment_id=<id> restart=true
   ```

   Use `list_deployments` to find the `deployment_id` of the release to restore:

   ```json
   { "operation": "list_deployments", "project": "my-app", "status": "success", "limit": 20 }
   ```

   - A `404` response means the id never existed on that node, was pruned, or the release was replaced and not kept. A `409` means the build exists but cannot be activated (e.g., belongs to another component, or files changed after staging).
   - Kept releases and staged builds count against `deployment.stagingRetention.maxCount` (`stagingRetention` default: `5`). Each kept release is a full installed copy of the component, `node_modules` included, so budget disk for it. `0` keeps no replaced releases.

7. **Deploy by reference for a reproducible source**: `by_ref=true` sends a pinned git reference instead of uploading the working directory, and the cluster fetches and builds that exact commit. It resolves the repository's `origin` remote and the current commit, then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`. Defaults to `HEAD`.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   Deploy a specific tag or commit with `ref`:

   ```bash
   harper deploy ref=v1.2.0 restart=true replicated=true
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   - Tags and branches are resolved to a full commit SHA before the deploy is sent. A `ref` that cannot be resolved stops the deploy — run `git fetch` and retry, or pass a full commit SHA.
   - Any other `ref` must name something a clone can fetch: `refs/heads/*` or `refs/tags/*`, or a bare branch or tag name. A qualified ref outside those, such as `refs/pull/123/head`, is rejected up front.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly.
   - Commit and push first — the cluster clones from the remote and only sees pushed commits.

8. **Check certification after a rolling deploy**: A deploy with `restart=rolling` certifies the release in a canary worker before rolling it out. The deploy response includes a `certification` field:

   | `certification` | Meaning                                                                                                                                                                         |
   | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `certified`     | The canary loaded the release; rollout proceeded.                                                                                                                               |
   | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced. |
   | `unavailable`   | Deploy restarted unchecked (no worker loads the component, `isolated` setting changed, already live, or `file:` directory source).                                              |
   | `not-requested` | The deploy did not restart.                                                                                                                                                     |
   - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. The error carries the decision as an object in `certification` with `status` set to `rejected`, or to `interrupted` for a restart that stopped before the canary decided.
   - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed and says why. Deploy a fix, or activate the same `deployment_id` again with `restart`.
   - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.

9. **Wait for a rolling deploy to finish**: A `deploy_component` with `"restart": "rolling"` returns a `restartJobId`. Poll it with `get_job` to learn whether every node took the release.

   ```json
   { "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
   ```

   `get_job` returns status `COMPLETE`, `IN_PROGRESS`, or `ERROR`. It answers only on the node that ran the job. A deploy-only role that waits for rolling deploys must include `get_job` in its operations allowlist.
   - `list_deployments` returns records newest first. Filter by `project` and `status`; omit `limit` to return every matching record. A deploy in progress reads `pending`, or `loading`, until its `completed_at` is set.

## Examples

### Full rolling deploy from a pinned tag

```bash
# Authenticate once
harper login https://my-cluster.harperdbcloud.com

# Deploy a pinned release with rolling restart
harper deploy \
  project=my-app \
  ref=v1.2.0 \
  target=https://my-cluster.harperdbcloud.com \
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

### Roll back to a previous release

```json
{
	"operation": "list_deployments",
	"project": "my-app"
}
```

Then:

```json
{
	"operation": "deploy_component",
	"project": "my-app",
	"deployment_id": "<id of the deployment you want back>",
	"restart": true
}
```

### Rejected canary — error response shape

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

- `harper login` stores a token; subsequent `harper deploy` calls to the same target need no credentials. See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) for cluster setup.
- For GitHub Actions, prefer OIDC workload identity over stored tokens. See [deploying-from-ci.md](deploying-from-ci.md).
- `restart=rolling` and `activate=false` cannot be combined.
- `deployment_id` activation takes no `package`, `payload`, `credentials`, install options, `urlPath`, or `host` — supplying them is rejected.
- `file:` directory sources (`package: file:<dir>`) cannot be staged and are not kept as rollback targets.
- `stagingRetention.maxCount` (default `5`) caps staged builds and kept replaced releases together per component.
- `get_job` on a `restartJobId` answers only on the node that received the deploy; any other node returns an empty array.
- A rolling deploy's record reads `rolling_out` until the job has visited every node; filter `list_deployments` without `status` and check each record's `status` for a finished value (`success`, `partial`, `failed`, `staged`). `completed_at` alone does not confirm a finished state, since a `rolling_out` record already has it.
- `enc:v1:` envelopes store only ciphertext — plaintext never leaves your machine and never appears in operation logs or replication.
- Tags used in `refs/tags` are resolved to a commit SHA before the deploy is sent; a tag that moves mid-deploy cannot cause nodes to run different code.
- `super_user` is required to run `harper deploy setup=true`.
