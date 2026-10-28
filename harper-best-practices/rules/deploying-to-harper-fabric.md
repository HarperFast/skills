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
  sourceCommit: 76b79e7af77b88d0f18a539d4de5cf898a340ded
  inputHash: b1b60a105feb4003
---

# Deploying to Harper Fabric

Instructions for the agent to deploy a Harper application to Harper Fabric using the CLI, verify certification status, and roll back by activating a previous release's `deployment_id`.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, checking whether a release was certified after rollout, or rolling back to a previous release without rebuilding. Also apply it when provisioning credentials for private repositories or staging a build for later activation.

## How It Works

1. **Log in to the cluster once**: Pass the cluster's **Application URL**, from its **Config → Overview** page, to `harper login`. The CLI stores the token, so later commands don't repeat credentials. If the current directory already has a `.env` file that sets no target, it also appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   - For a one-off command, `auth_username=` and `auth_password=` also work, and take precedence over environment variables and saved login tokens. Don't use them in production.
   - A bare `target` host defaults to `https://<host>:9925`.
   - Pass `json=true` to print the result as JSON instead of YAML.
   - For CI/CD pipelines, use workload identity (OIDC) or a refresh token from `harper login --for-ci` instead of a password. See [deploying-from-ci.md](deploying-from-ci.md) for a complete GitHub Actions workflow.

2. **Choose a package source**: The `package` field accepts any valid npm dependency value.

   | Source             | Example                                                                                       |
   | ------------------ | --------------------------------------------------------------------------------------------- |
   | Current directory  | Omit `package`                                                                                |
   | npm package        | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)    | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH) | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball            | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

3. **Deploy the application**: Run `harper deploy` with the required parameters.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

   Use `restart=rolling` for a staggered, zero-downtime restart across the cluster. Pass `replicated=false` to deploy to the called node only.

4. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source. Provision that credential once per component and source with `harper deploy setup=true`. (With `provider=github-actions`, it sets up GitHub Actions deploys instead: see [deploying-from-ci.md](deploying-from-ci.md).) It is interactive, and requires `super_user` — run it with an administrative credential.

   ```bash
   harper deploy setup=true
   ```

   The interactive flow:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope.
   3. Stores only the ciphertext with `set_secret`, scoped to the component, never in the global `processEnv` tier.
   4. Grants the component permission to resolve it with `grant_secret`.

   Prefer a `fine-grained` PAT with **Contents: Read-only** on the target repository. Avoid the `gh` CLI session token, which carries `read:org`, `gist`, `workflow`, and `repo` scopes across your whole account.

   Then deploy with `credential=true`:

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

   The response returns a `deployment_id` for the staged build. Make it live by deploying that `deployment_id`, as in step 6. Nothing changes until then, and `get_deployment` reports it as `staged`.
   - The activation takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host`. They are rejected, because the staged build already decided them.
   - Pass `restart` on the activation, not the stage.
   - Kept releases and staged builds count against `deployment.stagingRetention.maxCount` (default `5`). Each kept release is a full installed copy of the component, `node_modules` included, so budget disk for it. `0` keeps no replaced releases.
   - `file:` directory sources cannot be staged.

6. **Activate a staged build or roll back**: Use `deployment_id` to make a staged build live or restore a replaced release — no rebuild, resolve, or reinstall occurs.

   ```bash
   harper deploy project=<name> deployment_id=<id> restart=true
   ```

   Use `list_deployments` to find each deployment's id:

   ```json
   {
   	"operation": "list_deployments",
   	"project": "my-app",
   	"status": "success",
   	"limit": 20
   }
   ```

   - `list_deployments` returns records newest first. Filter by `project` and `status`; omit `limit` to return every matching record. A deploy in progress reads `pending`, or `loading`, until its `completed_at` is set.
   - A `404` response means the id never existed on that node, was pruned, or the release was replaced and not kept. A `409` means the build exists but cannot be activated (e.g., belongs to another component, or files changed after staging).

7. **Deploy by reference for a reproducible source**: `by_ref=true` sends a pinned git reference instead of uploading the working directory, and the cluster fetches and builds that exact commit. It resolves the repository's `origin` remote and the current commit (`HEAD`), then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`.

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
   - Commits must be pushed before deploying; the cluster clones from the remote.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly.

8. **Check certification after deploy**: A deploy with `restart=true` or `restart=rolling` runs a canary worker that loads the new release before rolling it out. The deploy response includes a `certification` field:

   | `certification` | Meaning                                                                                                                                                                                             |
   | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `certified`     | The canary loaded the release; rollout proceeded.                                                                                                                                                   |
   | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced.                     |
   | `unavailable`   | The deploy restarted unchecked: no worker on this node loads the component, its `isolated` setting changed, it was already live, or it was deployed from a local directory (`package: file:<dir>`). |
   | `not-requested` | The deploy did not restart.                                                                                                                                                                         |
   - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. The error carries the decision as an object in `certification` with `status` set to `rejected`, or to `interrupted` for a restart that stopped before the canary decided.
   - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed and says why. Deploy a fixed release, or activate the same `deployment_id` again with `restart`.
   - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.

9. **Wait for a rolling deploy to finish**: A `deploy_component` with `"restart": "rolling"` returns a `restartJobId`. Poll it with `get_job` to learn whether every node took the release.

   ```json
   { "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
   ```

   The job ends with status `COMPLETE` on full success, or `ERROR` with a `message` listing each node's outcome. A deploy-only role that polls rolling deploys must include `get_job` in its `operations` allowlist.

## Examples

**Full deploy to a remote cluster with rolling restart:**

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  package="HarperFast/application-template#semver:v1.0.0" \
  target=https://my-cluster.harperdbcloud.com \
  restart=rolling \
  replicated=true
```

**Deploy by pinned tag from a private repo:**

```bash
harper deploy \
  ref=v1.2.0 \
  credential=true \
  restart=rolling \
  replicated=true
```

**Stage a build, then activate it in a maintenance window:**

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

**Roll back to a previous release:**

```json
{
	"operation": "deploy_component",
	"project": "my-app",
	"deployment_id": "<id of the deployment you want back>",
	"restart": true
}
```

**Check rolling deploy job status:**

```json
{ "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
```

**Rejected canary — error response shape:**

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

- `harper login` stores the token; subsequent `harper deploy` commands targeting the same remote need no credentials repeated.
- `restart=rolling` exits `0` once the receiving node has taken the release and started the rolling restart job. Poll `restartJobId` with `get_job` to confirm all nodes reached `COMPLETE`.
- `replicated=false` restricts the deploy to the single node you called. On Harper Pro and Fabric, deploys go to every node by default.
- `activate: false` and `restart` cannot be combined. Pass `restart` on the `deployment_id` activation instead.
- `stagingRetention.maxCount` (default `5`) caps staged builds and kept replaced releases together per component. Builds pruned before activation must be staged again.
- `file:` directory sources cannot be staged and are not kept as rollback targets.
- The `enc:v1:` envelope means the plaintext token never leaves your machine — only ciphertext travels over the operations API and replication.
- A `fine-grained` PAT with **Contents: Read-only** is the recommended credential for private GitHub repository deploys. The `gh` session token carries `read:org` and other broad scopes and should be avoided.
- `super_user` is required to run `harper deploy setup=true`.
- `get_job` is recorded only on the node that ran the job; call it on that same node.
- See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) for setting up the cluster before deploying.
- See [deploying-from-ci.md](deploying-from-ci.md) for deploying from GitHub Actions with no stored credential.
