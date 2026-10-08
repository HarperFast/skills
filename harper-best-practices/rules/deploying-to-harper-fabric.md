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
    - reference/v5/operations-api/operations.md#`list_deployments`
    - reference/v5/operations-api/operations.md#`get_job`
  sourceCommit: e73e5efb2823cc52caf7a6458d67fbcff3bbff2c
  inputHash: fc5eb845ac203e77
---

# Deploying to Harper Fabric

Instructions for the agent to follow when deploying a Harper application to a Harper Fabric cluster, or any remote Harper instance, with the `harper` CLI, and when checking, staging, or going back to a release.

## When to Use

Apply this rule when deploying to a remote cluster, choosing how it restarts, reading a deploy's `certification`, staging a release to make live later, or rolling back to a previous release. To deploy from CI with no stored credential, see [deploying-from-ci.md](deploying-from-ci.md). To set up the cluster first, see [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md).

## How It Works

1. **Log in to the cluster once**: Pass the cluster's **Application URL**, from its **Config → Overview** page, to `harper login`. The CLI stores the token, so later commands don't repeat credentials. If the current directory already has a `.env` file that sets no target, it also appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   - For CI/CD on GitHub Actions, use workload identity (OIDC) instead, so the pipeline stores no Harper credential: see [deploying-from-ci.md](deploying-from-ci.md). Elsewhere, give the pipeline a refresh token from `harper login --for-ci` rather than a password.
   - For a one-off command, `auth_username=` and `auth_password=` also work, and take precedence over environment variables and saved login tokens. Don't use them in production.

2. **Deploy with a restart**: Run `harper deploy`, with `restart=true` or `restart=rolling` so the release is certified before it serves (step 3).

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

   - On Harper Pro and Fabric, a deploy goes to every node in the cluster unless you pass `replicated=false`. Harper core on its own does not replicate.
   - `project` defaults to the current directory's name for a directory deploy, or is derived from the package for a package deploy.
   - A bare `target` host defaults to `https://<host>:9925`.
   - Pass `json=true` to print the result as JSON instead of YAML.
   - Every result carries a `deployment_id`, staged or not. It names this release when you go back to it later (step 4).

3. **Choose the restart, and read `certification`**: `restart=true` restarts Harper after deploying. On a cluster, use `restart=rolling`, the staggered, zero-downtime restart: the command exits `0` once the node you called has taken the release and started the rolling restart's job, and returns its `restartJobId`.

   Both certify the release in a canary worker before rolling it out. The canary replaces worker 0 and loads every component, but is held out of traffic until it reports whether the deployed component loaded. Until then, the workers already running keep serving the previous release. A deploy that succeeds, and is not staged, reports the result in `certification`:

   | `certification` | Meaning                                                                                                                                                                                             |
   | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `certified`     | The canary loaded the release, and the rollout went on.                                                                                                                                             |
   | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced.                     |
   | `unavailable`   | The deploy restarted unchecked: no worker on this node loads the component, its `isolated` setting changed, it was already live, or it was deployed from a local directory (`package: file:<dir>`). |
   | `not-requested` | The deploy did not restart.                                                                                                                                                                         |
   - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. The error's `certification` is an object whose `status` is `rejected`, or `interrupted` for a restart that stopped before the canary decided.
   - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed. Deploy a fix, or once the cause is fixed, activate the same `deployment_id` again with `restart`.
   - **A rolling deploy exits before every node has taken the release.** The other nodes stage it, and the job activates it on each in turn, each with a canary of its own. A node that rejects it keeps the previous release, or fails closed if it had none. Nothing is rolled back on the others, and the job fails naming each node that did not activate it. The deployment record reports `success` while the job runs and after it fails, so poll the job instead: `harper get_job id=<restartJobId>` ends `COMPLETE`, or `ERROR` with a `message` listing each node's outcome under `activated`.
   - **Poll the node that received the deploy.** A job is recorded only on the node that ran it, so any other node answers `get_job` with an empty array. A role with an `operations` allowlist, or a token with an `operations` scope, must list `get_job` to poll it.
   - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.
   - A node running a version before v5.4.0 activates the release without a canary.

4. **Go back to a previous release by its `deployment_id`**: When a deploy replaces the live release, Harper keeps the replaced one under the `deployment_id` that deployed it. Activating that id puts back the exact installed release with no fetch, rebuild, or reinstall, where deploying an older commit installs it again from source. Find the id with `list_deployments`, then deploy it. On a cluster, restart with `rolling` and poll its job (step 3):

   ```bash
   harper list_deployments project=my-app status=success
   harper deploy project=my-app deployment_id=<id> restart=rolling
   ```

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "<id of the deployment you want back>",
   	"restart": true
   }
   ```

   - `list_deployments` returns records newest first. Filter by `project` and `status`; omit `limit` to return every matching record. A deploy in progress reads `pending`, or `loading`, until its `completed_at` is set.
   - The newest `success` is not necessarily the release every node is serving: a rolling deploy's record says `success` before the other nodes have taken the release, and keeps saying it if one rejects it.
   - Redeploy an older commit by `ref` (step 7) only when the release is no longer kept.
   - The activation restores the root config entry that deployment published. The release it replaces is kept in turn, so you can go forward again the same way.
   - Kept releases and staged builds count against `deployment.stagingRetention.maxCount` (default `5`). Each kept release is a full installed copy of the component, `node_modules` included, so budget disk for it. `0` keeps no replaced release.
   - A release made live before v5.3.0, or deployed from a `file:` directory, is not kept.
   - Each node answers for itself. A node that never had the release, or no longer keeps it, answers `404`, which `deploy_component` reports as a failed peer. `409` means the build is there but can't be activated.

5. **Stage a release to make live later**: `activate=false` (`activate: false` in the operation) builds and installs the release on each node without making it live, so the slow, fallible part happens when you choose and the cut-over is quick. The result's `deployment_id` names the staged build:

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"package": "npm:@my-org/my-app@1.2.3",
   	"activate": false
   }
   ```

   ```json
   {
   	"deployment_id": "a3f8c2d1-...",
   	"message": "Staged: my-app. Deploy it with deploy_component deployment_id=a3f8c2d1-..."
   }
   ```

   Make it live by deploying that `deployment_id`, as in step 4. Nothing changes until then, and `get_deployment` reports it as `staged`.
   - Pass `restart` on the activation, not the stage: `restart` is rejected alongside `activate: false`.
   - The activation takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host`. They are rejected, because the staged build already decided them.
   - Activating the release that is already live succeeds and changes nothing, so a retry is safe.
   - A staged build outlives later deploys: stage v2, deploy v3, and activating v2's id returns the component to v2.
   - `file:` directory sources cannot be staged.
   - Upgrade every node before staging. A node before v5.3.0 doesn't recognize `activate: false`, and serves the release immediately. A peer that doesn't confirm staging fails the operation with the node names.

6. **Choose a package source**: The `package` field accepts any valid npm dependency value:

   | Source                  | `package` value                                                                               |
   | ----------------------- | --------------------------------------------------------------------------------------------- |
   | Current local directory | Omit `package`                                                                                |
   | npm package             | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)         | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH)      | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball                 | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

7. **Deploy by reference for a reproducible source**: `by_ref=true` sends a pinned git reference instead of uploading the working directory, and the cluster fetches and builds that exact commit. It resolves the repository's `origin` remote and the current commit, then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`. Pass `ref` to deploy a specific tag or commit instead of `HEAD`; it implies `by_ref`.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   harper deploy ref=v1.2.0 restart=true replicated=true
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   - A `ref` is resolved to a full commit SHA before the deploy is sent, from the local checkout or the remote. A full commit SHA is accepted directly. If a `ref` can't be resolved, the deploy stops: run `git fetch` and retry, or pass a full SHA.
   - Any other `ref` must name something a clone can fetch: `refs/heads/*` or `refs/tags/*`, or a bare branch or tag name. A qualified ref outside those, such as `refs/pull/123/head`, is rejected up front.
   - Commit and push first: the cluster clones from the remote. `by_ref` warns when the working tree is dirty, and when the commit isn't on any remote branch. The second check is skipped under GitHub Actions.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly.
   - The cluster installs and builds from source on each node, so commit your lockfile if the build must be reproducible. If the build can't run on the node, deploy the built output as a payload instead.

8. **Deploy a private repository by reference**: Pass `credential=true` with `by_ref=true`. The CLI attaches a `credentials` reference, and the cluster resolves the secret in memory at clone time, so no token travels in the operation body or lands on disk.

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

   Provision that credential once per component and source with `harper deploy setup=true`. It is interactive, and its operations require **super_user**, so run it with an administrative credential, not the CI identity it provisions for. It:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope, so the plaintext never leaves your machine.
   3. Stores only the ciphertext with `set_secret`, scoped to the component, never in the global `processEnv` tier.
   4. Grants the component permission to resolve it with `grant_secret`.
   5. Prints the `credentials` reference for the deploy to use.

   Use a **fine-grained** personal access token with **Contents: Read-only** on that one repository. Avoid the `gh` CLI's session token: it typically carries `repo`, `read:org`, `gist`, and `workflow` scopes across your whole account. The sealed token is durable, and later deploys reuse it.

## Examples

**Deploy after logging in, and wait for a rolling restart:**

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  package="HarperFast/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=rolling \
  json=true > deploy.json
# Poll the node that received the deploy until the job is COMPLETE or ERROR
harper get_job id=<restartJobId from deploy.json> json=true
```

**Roll back to the release a deploy replaced, node by node:**

```bash
harper list_deployments project=my-app status=success
harper deploy project=my-app deployment_id=<previous deployment_id> restart=rolling json=true
# Then poll its restartJobId with get_job, as above
```

**Stage a release now, and make it live in a maintenance window:**

```bash
harper deploy project=my-app package=npm:@my-org/my-app@1.2.3 activate=false
# Later, with the deployment_id the stage returned
harper deploy project=my-app deployment_id=<staged deployment_id> restart=true
```

**Deploy a pull request's head commit by reference in GitHub Actions:**

```bash
harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
```

**Deploy a private repository by reference:**

```bash
# Once, as super_user
harper deploy setup=true

# Every deploy
harper deploy by_ref=true credential=true restart=true replicated=true
```
