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
  sourceCommit: 6cd8a2ea6372924486aac46a5d96ba00c10eff07
  inputHash: 3894a8f69e188b7e
---

# Deploying to Harper Fabric

Instructions for the agent to deploy a Harper application to Harper Fabric using the CLI, verify certification status, and roll back by activating a previous release's `deployment_id`.

**Instead of:** Docker Compose stacks; deploying several services separately. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, checking whether a rolling deploy was certified on each node, or restoring a previous release without rebuilding. Use it alongside [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) when setting up a new cluster, and [deploying-from-ci.md](deploying-from-ci.md) for GitHub Actions pipelines.

## How It Works

1. **Authenticate against the cluster**: Run `harper login` once, pointing at the cluster's Application URL. The CLI stores the token and, if a `.env` file is present with no target set, appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   For CI/CD pipelines, use workload identity (OIDC) or a refresh token from `harper login --for-ci` instead of a password. See [deploying-from-ci.md](deploying-from-ci.md) for a complete GitHub Actions workflow. For a one-off command, `auth_username=` and `auth_password=` parameters are also available but are not recommended for production — they take precedence over environment variables and saved login tokens.

2. **Deploy the application**: Run `harper deploy` with the required parameters. A bare `target` host defaults to `https://<host>:9925`. Use `restart=rolling` for a staggered, zero-downtime restart across the cluster. Pass `replicated=false` to deploy to the called node only. Pass `json=true` to print output as JSON instead of the default YAML.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=rolling \
     replicated=true
   ```

   Key parameters:

   | Parameter                           | Description                                                                                                                           |
   | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
   | `project=<name>`                    | Component project name. Defaults to the current directory name.                                                                       |
   | `package=<reference>`               | npm, GitHub, or tarball reference. Omit to upload the current directory.                                                              |
   | `target=<url>`                      | Remote Harper instance URL. A bare host defaults to `https://<host>:9925`.                                                            |
   | `restart=true` or `restart=rolling` | Restart after deploy. `rolling` restarts nodes one at a time, keeping others in rotation. Cannot be combined with `activate=false`.   |
   | `replicated=false`                  | Deploy to the called node only. Default on Harper Pro/Fabric deploys to every node.                                                   |
   | `activate=false`                    | Build and install without making the release live. Records a `deployment_id` for later activation. Cannot be combined with `restart`. |
   | `deployment_id=<id>`                | Activate a staged or previously replaced release with no rebuild or reinstall.                                                        |
   | `wait=false`                        | With `restart=rolling`, exit once the called node has taken the release.                                                              |
   | `wait_timeout=<ms>`                 | With `restart=rolling`, maximum wait time per node. Defaults to ten minutes per node.                                                 |

3. **Choose a package source**: The `package` field accepts any valid npm dependency value.

   | Source             | Example                                                                                       |
   | ------------------ | --------------------------------------------------------------------------------------------- |
   | Current directory  | Omit `package`                                                                                |
   | npm package        | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)    | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH) | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball            | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

4. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source. (With `provider=github-actions`, it sets up GitHub Actions OIDC deploys instead.) This requires `super_user` privileges and is interactive — run it with an administrative credential rather than the CI identity it provisions for.

   ```bash
   harper deploy setup=true
   ```

   The setup flow:
   - Fetches the cluster's public key with `get_secrets_public_key`.
   - Encrypts the token locally into an `enc:v1:` envelope.
   - Stores only the ciphertext with `set_secret` in the component-scoped tier.
   - Grants the component permission to resolve it with `grant_secret`.

   **Use a fine-grained PAT** for GitHub repositories: select **Contents: Read-only** on that one repository. Avoid the `gh` CLI session token, which typically carries `repo`, `read:org`, `gist`, and `workflow` scopes across your whole account.

   Then deploy with `credential=true`:

   ```bash
   harper deploy by_ref=true credential=true restart=rolling replicated=true
   ```

5. **Deploy by reference for a reproducible source**: `by_ref=true` sends a pinned git reference instead of uploading the working directory, and the cluster fetches and builds that exact commit. It resolves the repository's `origin` remote and the current commit, then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   To deploy a specific tag or commit:

   ```bash
   harper deploy ref=v1.2.0 restart=true replicated=true
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   - Tags and branches are resolved to a full commit SHA before the deploy is sent. A `ref` that cannot be resolved stops the deploy — run `git fetch` and retry, or pass a full commit SHA. A full commit SHA is accepted directly with no resolution attempted.
   - Only `refs/heads/*` and `refs/tags/*` namespaces are accepted. A qualified ref outside those (e.g. `refs/pull/123/head`) is rejected up front, even if your own checkout can resolve it, because the cluster could resolve that commit and still never check it out.
   - Commit and push first — the cluster clones from the remote and only sees pushed commits.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly:

     ```bash
     harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
     ```

6. **Activate a staged build**: Make a staged build live using its `deployment_id`. Pass `restart` here, not on the stage step. Takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — those are rejected rather than ignored, because the staged build already decided them.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "a3f8c2d1-..."
   }
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

   The response includes a `deployment_id` naming the staged artifact. Staged builds and replaced releases together count against `deployment.stagingRetention.maxCount` (default `5`). Each kept release is a full installed copy of the component, `node_modules` included. The oldest are pruned at the start of the component's next deploy and at startup.

8. **Roll back to a previous release**: Use `list_deployments` to find the `deployment_id` of the release to restore, then activate it with `restart=true`. This swaps in the exact installed bytes with no fetch, rebuild, or reinstall. The release it replaces is kept in turn.

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

9. **Wait for a rolling deploy to finish**: A `deploy_component` with `"restart": "rolling"` returns a `restartJobId`. Poll it with `get_job` to learn whether every node took the release.

   ```json
   { "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
   ```

   `get_job` returns status `COMPLETE`, `IN_PROGRESS`, or `ERROR`. It answers only on the node that ran the job — `system.hdb_job` is not replicated. For a rolling deploy, that is the node that received the deploy. A deploy-only role that polls for rolling deploys must include `get_job` (and from v5.4.0, `get_deployment`) in its operations allowlist.

10. **Check certification status**: A deploy with `restart=true` or `restart=rolling` runs a canary worker that loads the new release before rolling it out. The deploy response includes a `certification` field:

    | `certification` | Meaning                                                                                                                                                                         |
    | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `certified`     | The canary loaded the release; rollout proceeded.                                                                                                                               |
    | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced. |
    | `unavailable`   | Deploy restarted unchecked (no worker loads the component, `isolated` setting changed, already live, or `package: file:<dir>` source).                                          |
    | `not-requested` | The deploy did not restart.                                                                                                                                                     |
    - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. The error body includes `deployment_id` and a `certification` object with `status` set to `rejected`, or `status: "interrupted"` for a restart that stopped before the canary decided.
    - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed and says why. Deploy a fixed release, or activate the same `deployment_id` again with `restart` once the cause is fixed.
    - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.

11. **Monitor `list_deployments` correctly**: A deploy in progress reads `pending`, or `loading` once its release has started loading. A rolling deploy's record reads `rolling_out` until the job has visited every node; filter `list_deployments` without `status` and check that each record's `status` is a finished one (`success`, `failed`, `staged`, or `partial`). `completed_at` alone does not indicate a finished deploy, since a `rolling_out` record already has it.
    - A `404` response means the id never existed on that node, was pruned, or the release was replaced and not kept. A `409` means the build exists but cannot be activated (e.g., belongs to another component, or files changed after staging).

## Examples

### Full rolling deploy from a git tag

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  ref=v1.2.0 \
  target=https://my-cluster.harperdbcloud.com \
  restart=rolling \
  replicated=true
```

### Stage a build, then activate in a maintenance window

```bash
# Stage only — nothing goes live
harper deploy \
  project=my-app \
  package="npm:@my-org/my-app@1.2.3" \
  target=https://my-cluster.harperdbcloud.com \
  activate=false \
  replicated=true

# Later: activate by deployment_id with a rolling restart
harper deploy \
  project=my-app \
  deployment_id=a3f8c2d1-... \
  target=https://my-cluster.harperdbcloud.com \
  restart=rolling \
  replicated=true
```

### Roll back to a previous release

```bash
# List deployments to find the id (operations API)
# Then activate the previous release
harper deploy \
  project=my-app \
  deployment_id=<previous-id> \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

### Deploy a private repo with a sealed credential

```bash
# Provision once (requires super_user)
harper deploy setup=true

# Deploy using the sealed credential
harper deploy \
  by_ref=true \
  credential=true \
  restart=rolling \
  replicated=true \
  target=https://my-cluster.harperdbcloud.com
```

## Notes

- `harper login` stores the token and, if a `.env` file is present with no target set, appends `HARPER_CLI_TARGET` to it.
- `enc:v1:` envelopes produced by `harper deploy setup=true` are stored scoped to the component, never in the global `processEnv` tier. The plaintext never leaves your machine.
- `replicated=false` restricts a deploy to the single called node. On Harper Pro and Fabric, omitting it deploys to every node.
- `restart=rolling` waits for every node to take a certified release unless `certification` is `unavailable`. Pass `wait=false` to exit after the called node takes the release.
- Kept releases and staged builds share the `stagingRetention` cap (`deployment.stagingRetention.maxCount`, default `5`). At the default, budget disk for up to five extra full copies of the component per node.
- `file:` directory sources cannot be staged (`activate=false`) and are not kept after replacement — rollback is not available for them.
- `not-requested` certification means the deploy did not restart; no canary check ran.
- The `list_deployments` response strips `payload_blob` and replaces it with `payload_blob_present`; use `get_deployment_payload` to retrieve the tarball.
- A deploy-only role that waits for rolling deploys must include `get_job` in its operations allowlist; from v5.4.0, also `get_deployment`.
- `system.hdb_job` is not replicated — `get_job` answers only on the node that ran the job.
