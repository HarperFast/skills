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
  sourceCommit: 0a29827da61afe7fff40ee8de87e1d4c2c286bea
  inputHash: 853f3fbf9b1d9f6d
---

# Deploying to Harper Fabric

Instructions for the agent to deploy a Harper application to Harper Fabric using the CLI, verify certification status, and roll back by activating a previous release's `deployment_id`.

**Instead of:** Docker Compose stacks; deploying several services separately. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, checking whether a rolling deploy was certified on each node, or restoring a previous release without rebuilding. Use it alongside [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) when setting up a new cluster, and [deploying-from-ci.md](deploying-from-ci.md) for GitHub Actions pipelines.

## How It Works

1. **Authenticate against the cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on **Config → Overview**). The CLI stores the token and sets the URL as the default target. From v5.4.0, the CLI stops with an error if a `.env` file in the current directory sets `HARPER_CLI_TARGET` and your environment does not.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   For CI/CD pipelines, use workload identity (OIDC) or a refresh token from `harper login --for-ci` instead of a password. See [deploying-from-ci.md](deploying-from-ci.md) for a complete GitHub Actions workflow. For a one-off command, `auth_username=` and `auth_password=` are also available but not recommended for production — they take precedence over environment variables and saved login tokens.

2. **Deploy the application**: Run `harper deploy` with the required parameters. A bare `target` host defaults to `https://<host>:9925`. Use `restart=rolling` for a staggered, zero-downtime restart across the cluster. Pass `replicated=false` to deploy to the called node only.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=rolling \
     replicated=true
   ```

3. **Choose a package source**: The `package` field accepts any valid npm dependency value.

   | Source             | Example                                                                                       |
   | ------------------ | --------------------------------------------------------------------------------------------- |
   | npm package        | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)    | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH) | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball            | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

4. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source. (With `provider=github-actions`, it sets up GitHub Actions OIDC deploys instead.) This requires `super_user` privileges and is interactive. It calls `get_secrets_public_key`, `set_secret`, and `grant_secret`. Run it with an administrative credential rather than the CI identity it provisions for.

   ```bash
   harper deploy setup=true
   ```

   The flow:
   - Fetches the cluster's public key with `get_secrets_public_key`.
   - Encrypts the token locally into an `enc:v1:` envelope.
   - Stores only the ciphertext with `set_secret`, scoped to the component.
   - Grants the component permission to resolve it with `grant_secret`.
   - Prints the `credentials` reference for the deploy to use.

   Prefer a **fine-grained** personal access token scoped to **Contents: Read-only** on the target repository. Avoid the `gh` CLI session token, which carries `read:org`, `gist`, `workflow`, and `repo` scopes across your whole account. The `enc:v1:` envelopes produced by `harper deploy setup=true` are stored scoped to the component, never in the global `processEnv` tier. The plaintext never leaves your machine.

   Then deploy with `credential=true`:

   ```bash
   harper deploy by_ref=true credential=true restart=rolling replicated=true
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

   Tags and branches are resolved to a full commit SHA before the deploy is sent. A `ref` that cannot be resolved stops the deploy — run `git fetch` and retry, or pass a full commit SHA. A full commit SHA is accepted directly with no resolution. Only `refs/heads/*` and `refs/tags/*` namespaces are accepted; qualified refs outside those (e.g. `refs/pull/123/head`) are rejected up front.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly:

     ```bash
     harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
     ```

6. **Activate a staged build**: Make a staged build live using its `deployment_id`. Pass `restart` here, not on the stage step. Takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — those are rejected rather than ignored.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "a3f8c2d1-...",
   	"restart": true
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

   The response names the artifact waiting to be activated:

   ```json
   {
   	"deployment_id": "a3f8c2d1-...",
   	"message": "Staged: my-app. Deploy it with deploy_component deployment_id=a3f8c2d1-..."
   }
   ```

   The response includes a `deployment_id` naming the staged artifact. Staged builds and replaced releases together count against `deployment.stagingRetention.maxCount` (default `5`). Each kept release is a full installed copy of the component, `node_modules` included. The oldest are pruned at the start of the component's next deploy and at startup.
   - `404` means the id never existed on that node, was pruned, or the release was replaced and not kept. A `409` means the build exists but cannot be activated (e.g., belongs to another component, or files changed after staging).

8. **Roll back to a previous release**: Activate a kept release by its `deployment_id` — no rebuild, resolve, or install. Use `list_deployments` to find the id.

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

9. **Find previous deployment IDs**: Call `list_deployments` to retrieve deployment records with their IDs, newest first.

   ```json
   {
   	"operation": "list_deployments",
   	"project": "my-app",
   	"status": "success",
   	"limit": 20
   }
   ```

   - The `list_deployments` response strips `payload_blob` and replaces it with `payload_blob_present`; use `get_deployment_payload` to retrieve the tarball.

10. **Check rolling deploy job status**: A `deploy_component` with `"restart": "rolling"` returns a `restartJobId`. Call `get_job` on the node that received the deploy — `system.hdb_job` is not replicated.

    ```json
    { "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
    ```

    `get_job` returns status `COMPLETE`, `IN_PROGRESS`, or `ERROR`. It answers only on the node that ran the job — `system.hdb_job` is not replicated. For a rolling deploy, that is the node that received the deploy. A deploy-only role that polls for rolling deploys must include both `get_job` and `get_deployment` in its `operations` allowlist.

11. **Monitor `list_deployments` correctly**: A deploy in progress reads `pending`, or `loading` once its release has started loading. A rolling deploy's record reads `rolling_out` until the job has visited every node; filter `list_deployments` without `status` and check each record's `status` is a finished one (`success`, `failed`, `staged`, or `partial`). `completed_at` alone does not indicate a finished record, since a `rolling_out` record already has it.

12. **Check certification status**: Every deploy response that is not staged includes a `certification` field:

    | `certification` | Meaning                                                                                                                                                                         |
    | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `certified`     | The canary loaded the release; rollout proceeded.                                                                                                                               |
    | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced. |
    | `unavailable`   | Deploy restarted unchecked (no worker loads the component, `isolated` setting changed, already live, or `package: file:<dir>` source).                                          |
    | `not-requested` | The deploy did not restart.                                                                                                                                                     |
    - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. The error body includes `certification` as an object with `status: "rejected"` (or `status: "interrupted"` for a restart that stopped before the canary decided), `reason`, `failures`, and `restored`.

    - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed and says why. Deploy a fixed release, or activate the same `deployment_id` again with `restart`.

    - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.

### Key Parameters

| Parameter                           | Description                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `project=<name>`                    | Component project name. Defaults to current directory name.                                                        |
| `package=<reference>`               | npm, GitHub, or tarball reference. Omit to deploy current directory.                                               |
| `target=<url>`                      | Remote Harper instance URL. Bare host defaults to `https://<host>:9925`.                                           |
| `restart=true` or `restart=rolling` | Restart after deploy. `rolling` restarts nodes one at a time. Cannot combine with `activate=false`.                |
| `replicated=false`                  | Deploy to the called node only.                                                                                    |
| `activate=false`                    | Build and install without making live. Returns `deployment_id`. Cannot combine with `restart`.                     |
| `deployment_id=<id>`                | Activate a staged or previously replaced release. Takes no build inputs.                                           |
| `by_ref=true`                       | Deploy from pinned git commit via `origin` remote.                                                                 |
| `ref=<committish>`                  | Branch, tag, or commit SHA to deploy. Resolved to SHA. Implies `by_ref`.                                           |
| `credential=true`                   | Attach sealed credential for private repository clone.                                                             |
| `setup=true`                        | Interactively provision an encrypted deploy credential. Requires `super_user`.                                     |
| `wait=false`                        | With `restart=rolling`, exit after the called node takes the release.                                              |
| `wait_timeout=<ms>`                 | With `restart=rolling`, maximum wait time per node. Default: ten minutes per node.                                 |
| `auth_username=` / `auth_password=` | One-off authentication parameters. Take precedence over env vars and saved tokens. Not recommended for production. |
| `json=true`                         | Print output as JSON instead of YAML.                                                                              |

## Examples

### Standard replicated rolling deploy

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  package="HarperFast/application-template#semver:v1.0.0" \
  restart=rolling \
  replicated=true
```

### Deploy by git tag reference

```bash
harper deploy ref=v1.2.0 restart=rolling replicated=true
```

### Stage a build, then activate in a maintenance window

```bash
# Stage only — nothing goes live
harper deploy project=my-app package="npm:@my-org/my-app@1.2.3" activate=false

# Later: activate by deployment_id
harper deploy project=my-app deployment_id=a3f8c2d1-... restart=true
```

### Roll back to a previous release

```bash
# Find the deployment_id to restore via list_deployments, then:
harper deploy project=my-app deployment_id=<previous-id> restart=true
```

### Check rolling deploy job

```json
{ "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
```

The job ends `COMPLETE` on success, or `ERROR` with a `message` listing each node's outcome under `activated`. For a certified rolling deploy, also poll `get_deployment` on the deployment record, which reads `rolling_out` until the job finishes, then `success` or `partial`.

### Private repository deploy with credential

```bash
# Provision once (requires super_user)
harper deploy setup=true

# Deploy referencing the sealed credential
harper deploy by_ref=true credential=true restart=rolling replicated=true
```

## Notes

- `refs/tags` and `refs/heads/*` are the only accepted qualified ref namespaces. Refs outside these (e.g. `refs/pull/123/head`) are rejected even if your local checkout can resolve them.
- The `enc:v1:` envelope means the plaintext token never leaves your machine — only ciphertext travels over the operations API and replication.
- `deployment.stagingRetention.maxCount` (default `5`) caps staged builds and kept replaced releases together per component. Oldest are pruned at the next deploy or startup.
- `get_job` answers only on the node that ran the job; `system.hdb_job` is not replicated. For a rolling deploy, that is the node that received the deploy.
- A deploy-only role that waits for rolling deploys must include both `get_job` and `get_deployment` in its `operations` allowlist.
- `not-requested` in `certification` means the deploy completed without a restart — no canary check was performed.
- `fails closed` applies when a rejected release has no previous release to restore: the component stays unloaded on that node until a fixed release is deployed or the same `deployment_id` is activated again with `restart`.
- The `list_deployments` response strips `payload_blob` and replaces it with `payload_blob_present`; use `get_deployment_payload` to retrieve the tarball.
- For CI/CD pipelines, see [deploying-from-ci.md](deploying-from-ci.md) for the OIDC workload identity approach, which stores no Harper credential in the pipeline.
