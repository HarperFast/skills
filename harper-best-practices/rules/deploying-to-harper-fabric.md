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
  sourceCommit: 489477b2259ba148f4e526ea4b5cd24041ceec03
  inputHash: 53279ae8c94cde2b
---

# Deploying to Harper Fabric

Instructions for the agent to deploy a Harper application to Harper Fabric using the CLI, verify certification, and roll back using a previous release's `deployment_id`.

**Instead of:** Docker Compose stacks; deploying several services separately. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, checking whether a rolling deploy was certified on each node, or restoring a previous release without rebuilding. Also apply it when provisioning credentials for private-source deploys or staging a build for later activation.

## How It Works

1. **Authenticate against the cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on **Config → Overview**). The CLI stores the token and sets the URL as the default target. If the current directory has a `.env` file, and neither that file nor your environment sets `HARPER_CLI_TARGET` or `CLI_TARGET`, login appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   For CI/CD pipelines, use workload identity (OIDC) or a refresh token from `harper login --for-ci` instead of a password. See [deploying-from-ci.md](deploying-from-ci.md) for a complete GitHub Actions workflow. For a one-off command, `auth_username=` and `auth_password=` are available but not recommended for production.

2. **Deploy the application**: Run `harper deploy` with the required parameters. A bare `target` host defaults to `https://<host>:9925`. Use `restart=rolling` for a staggered, zero-downtime restart across the cluster. Pass `replicated=false` to restrict the deploy to the single node you called; on Harper Fabric, omit it to reach every node.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=rolling \
     replicated=true
   ```

   Key parameters:

   | Parameter             | Description                                                                           |
   | --------------------- | ------------------------------------------------------------------------------------- |
   | `package=<reference>` | npm, GitHub, or tarball reference. Omit to deploy current directory.                  |
   | `target=<url>`        | Remote Harper instance URL. Bare host defaults to `https://<host>:9925`.              |
   | `restart=rolling`     | Restart nodes one at a time; each stays in rotation while it restarts.                |
   | `replicated=false`    | Deploy to the called node only.                                                       |
   | `wait=false`          | With `restart=rolling`, exit after the called node takes the release.                 |
   | `wait_timeout=<ms>`   | With `restart=rolling`, maximum wait time per node. Default: ten minutes per node.    |
   | `activate=false`      | Build and install without making the release live. Cannot be combined with `restart`. |
   | `ref=<committish>`    | Branch, tag, or commit SHA to deploy. Resolved to SHA. Implies `by_ref`.              |
   | `json=true`           | Print output as JSON instead of YAML.                                                 |

3. **Choose a package source**: The `package` field accepts any valid npm dependency value.

   | Format                  | Example                                                                                       |
   | ----------------------- | --------------------------------------------------------------------------------------------- |
   | Current local directory | Omit `package`                                                                                |
   | npm package             | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)         | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH)      | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball                 | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

4. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source. (With `provider=github-actions`, it sets up GitHub Actions OIDC deploys instead.) This requires `super_user` privileges — run it with an administrative credential, not the CI identity it provisions for.

   ```bash
   harper deploy setup=true
   ```

   The setup flow:
   - Fetches the cluster's public key with `get_secrets_public_key`.
   - Encrypts the token locally into an `enc:v1:` envelope.
   - Stores only the ciphertext with `set_secret` in the component-scoped tier — never in the global `processEnv` tier that every component and child process can read.
   - Grants the component permission to resolve it with `grant_secret`.

   Prefer a **fine-grained** personal access token scoped to **Contents: Read-only** on the target repository. Avoid the `gh` CLI session token, which carries `read:org`, `gist`, `workflow`, and `repo` scopes across your whole account. The encrypted token is durable and replayed on every cold deploy and rollback, so use the narrowest credential that does the job.

   Then deploy with `credential=true`:

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

5. **Deploy by reference for a reproducible source**: `by_ref=true` sends a pinned git reference instead of uploading the working directory, and the cluster fetches and builds that exact commit. It resolves the repository's `origin` remote and the current commit, then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   Deploy a specific tag or commit with `ref`:

   ```bash
   harper deploy ref=v1.2.0 restart=true replicated=true
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   Tags and branches are resolved to a full commit SHA before the deploy is sent. A `ref` that cannot be resolved stops the deploy — run `git fetch` and retry, or pass a full commit SHA. A full commit SHA is accepted directly with no resolution step. Valid refs must be in `refs/heads/*` or `refs/tags/*` if qualified; a ref like `refs/pull/123/head` is rejected up front even if your local checkout can resolve it. Commit and push before deploying — the cluster clones from the remote and only sees pushed commits.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly:

     ```bash
     harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
     ```

6. **Activate a staged build**: Make a staged build live using its `deployment_id`. Pass `restart` here, not on the stage step. Takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — those are rejected rather than ignored.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "a3f8c2d1-..."
   }
   ```

   Or via the CLI:

   ```bash
   harper deploy project=<name> deployment_id=<id> restart=true
   ```

7. **Stage a build for later activation**: Pass `activate=false` (`activate: false` in the operation) to build and install without making the release live. `activate: false` cannot be combined with `restart`.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"package": "npm:@my-org/my-app@1.2.3",
   	"activate": false
   }
   ```

   The response names the artifact that is now waiting:

   ```json
   {
   	"deployment_id": "a3f8c2d1-...",
   	"message": "Staged: my-app. Deploy it with deploy_component deployment_id=a3f8c2d1-..."
   }
   ```

   The response includes a `deployment_id` naming the staged artifact. Staged builds and replaced releases together count against `deployment.stagingRetention.maxCount` (default `5`). Each kept release is a full installed copy of the component, `node_modules` included. The oldest are pruned at the next deploy or startup.
   - `404` means the id never existed on that node, was pruned, or the release was replaced and not kept. A `409` means the build exists but cannot be activated (e.g., belongs to another component, or files changed after staging).

8. **Roll back to a previous release**: Use `list_deployments` to find the `deployment_id` of the release to restore. Then activate that id with `restart`. This swaps in the exact installed release with no fetch, rebuild, or reinstall. The release it replaces is kept in turn, so you can go forward again the same way.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "<id of the deployment you want back>",
   	"restart": true
   }
   ```

9. **Check certification after a rolling deploy**: A deploy with `"restart": "rolling"` certifies the release on each node using a canary worker before rolling it out. The deploy response includes a `certification` field:

   | `certification` | Meaning                                                                                                                                                                         |
   | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `certified`     | The canary loaded the release; rollout proceeded.                                                                                                                               |
   | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced. |
   | `unavailable`   | Deploy restarted unchecked (no worker loads the component, `isolated` setting changed, already live, or `package: file:<dir>` source).                                          |
   | `not-requested` | The deploy did not restart.                                                                                                                                                     |
   - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. A restart that stops before the canary decides is reported with `status: "interrupted"`.
   - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed and says why. Deploy a fixed release, or activate the same `deployment_id` again with `restart` once the cause is fixed.
   - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.

10. **Check rolling deploy job status**: A `deploy_component` with `"restart": "rolling"` returns a `restartJobId`. Call `get_job` on the node that received the deploy — `system.hdb_job` is not replicated.

    ```json
    { "operation": "get_job", "id": "<restartJobId>" }
    ```

    `get_job` returns status `COMPLETE`, `IN_PROGRESS`, or `ERROR`. It answers only on the node that ran the job — `system.hdb_job` is not replicated. For a rolling deploy, that is the node that received the deploy. A deploy-only role that polls for rolling deploys must include `get_job` in its operations allowlist. The job ends `COMPLETE` on success, or `ERROR` with a `message` listing each node's outcome under `activated`.

11. **Monitor `list_deployments` correctly**: A deploy in progress reads `pending`, or `loading` once its release has started loading. A rolling deploy's record reads `rolling_out` until the job has visited every node; filter `list_deployments` without `status` and check each record's `status` is a finished one (`success`, `failed`, `staged`, or `partial`). `completed_at` alone does not indicate completion, since a `rolling_out` record already has it.

    ```json
    {
    	"operation": "list_deployments",
    	"project": "my-app",
    	"limit": 20
    }
    ```

    - The `list_deployments` response strips `payload_blob` and replaces it with `payload_blob_present`; use `get_deployment_payload` to retrieve the tarball.

## Examples

### Full rolling deploy from a git tag

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  ref=v1.2.0 \
  restart=rolling \
  replicated=true \
  credential=true
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

Activate later with restart:

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
{ "operation": "list_deployments", "project": "my-app", "limit": 10 }
```

```json
{
	"operation": "deploy_component",
	"project": "my-app",
	"deployment_id": "<previous-deployment-id>",
	"restart": true
}
```

### Check a rolling deploy job

```json
{ "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
```

The job ends `COMPLETE` when every node has taken the release, or `ERROR` with node-level detail if any node did not.

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

- `replicated=false` restricts a deploy to the single node you called. On Harper Fabric, omit this parameter to reach every node.
- `restart=rolling` cannot be combined with `activate=false`.
- `deployment_id` activation takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — supplying them is rejected.
- `file:` directory sources cannot be staged with `activate=false` and are not kept as rollback targets.
- `deployment.stagingRetention.maxCount` (default `5`) caps staged builds and kept replaced releases together per component. At the default, budget disk for up to five extra copies per component, `node_modules` included.
- A deploy-only role that waits for rolling deploys must include `get_job` in its operations allowlist.
- `get_job` answers only on the node that ran the job — `system.hdb_job` is not replicated.
- The `enc:v1:` envelope is the only form of the token that ever leaves your machine or appears in API logs.
- The secret provisioned by `harper deploy setup=true` is stored scoped to the component, never in the global `processEnv` tier.
- For creating the cluster itself, see [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md). For full CI/CD pipeline setup, see [deploying-from-ci.md](deploying-from-ci.md).
