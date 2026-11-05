---
name: deploying-from-ci
description: >-
  How to deploy a Harper application from GitHub Actions with OIDC trusted
  publishing, so CI stores no Harper credential, including the one-command setup
  with `harper deploy setup=true provider=github-actions`.
metadata:
  mode: generate
  sources:
    - reference/v5/cli/commands.md#GitHub Actions deploys (OIDC)
    - >-
      learn/developers/deploying-from-ci.md#Let the workflow authenticate with
      OIDC
    - >-
      learn/developers/deploying-from-ci.md#Path A: deploy a tagged release from
      your repository
    - >-
      learn/developers/deploying-from-ci.md#Give Harper a durable credential for
      a private source
    - >-
      learn/developers/deploying-from-ci.md#Path B: build in CI, publish to
      GitHub Packages, deploy the artifact
    - learn/developers/deploying-from-ci.md#Check the deployment record
    - learn/developers/deploying-from-ci.md#Operational notes
    - reference/v5/cli/authentication.md#Workload identity (OIDC)
    - >-
      reference/v5/operations-api/operations.md#Policy specificity for GitHub
      Actions
    - reference/v5/operations-api/operations.md#`list_oidc_trust`
    - reference/v5/operations-api/operations.md#`drop_oidc_trust`
  sourceCommit: 0a29827da61afe7fff40ee8de87e1d4c2c286bea
  inputHash: b446fbae2e45e83d
---

# Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to follow when deploying a Harper application from GitHub Actions using OIDC trusted publishing, so no Harper credential is stored in CI.

## When to Use

Apply this rule when wiring up a GitHub Actions workflow to deploy a Harper application without storing a `HARPER_CLI_REFRESH_TOKEN` or any other durable credential in CI. Use it when setting up a new pipeline, rotating access, or diagnosing a failed OIDC exchange. See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for Fabric-specific deployment context.

## How It Works

### One-Command Setup (branch-triggered deploys)

1. **Run setup once** from the project's checkout, signed in as a `super_user` (`harper login`). Remove any `HARPER_CLI_TARGET` line from the checkout's `.env` first:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app
   ```

   If your workflow file is not `.github/workflows/deploy.yaml`, pass it explicitly with `workflow=`. Otherwise the policy pins `deploy.yaml` and runs of your workflow cannot match it:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
   ```

2. **Understand what setup does** — it performs these steps in order:
   - Resolves the GitHub repository from the checkout's `origin` remote (or `repo=<owner>/<name>`), fetching its numeric id and canonical name. Pass `repository_id=<id>` when neither `gh` nor the public API can answer (e.g., a private repo without `gh`).
   - Validates the workflow file: it must be able to run on `main` (or `branch=`), run a job in the `production` environment (`environment=`), and grant `permissions: id-token: write`. Setup stops before writing anything if the workflow could never match or never request a token.
   - Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_deployment`, `get_job`, and `registration_info`, plus the trust policy `github-actions-<project>`.
   - Reads the policy back and compares it claim by claim with what it intended to write.
   - Sets the repository's `HARPER_CLI_TARGET` variable via `gh` if one does not already exist.

3. **Re-running setup** leaves the cluster and variable unchanged. A role, user, or policy that already exists but differs stops setup before it writes. To replace a policy, drop it first:

   ```bash
   harper drop_oidc_trust id=github-actions-<project>
   ```

   Then run setup again.

4. **Revoke access** when needed:
   - Stop future runs: `harper drop_oidc_trust id=github-actions-<project>`
   - Also stop tokens already issued (valid up to one hour): `harper alter_user username=<project>-ci-deploy active=false`

### Manual Setup (tag-triggered deploys or custom policies)

When deploying on version tags, `workflow_ref` cannot be pinned (the tag is unknown at policy-write time). Create the role, user, and policy by hand.

1. **Log in as `super_user`**:

   ```bash
   harper login https://my-cluster.example.com:9925
   ```

2. **Create a deploy-only role and user**:

   ```bash
   harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
   harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
   ```

   | Operation           | Purpose                                                                                    |
   | ------------------- | ------------------------------------------------------------------------------------------ |
   | `deploy_component`  | The deploy itself                                                                          |
   | `get_deployment`    | Read deployment record; required for `harper deploy restart=rolling` to wait on every node |
   | `get_job`           | Poll the rolling restart job; required or wait step fails with `403`                       |
   | `registration_info` | Version check before upload; omitting it causes a refused-operation log entry per run      |
   - `restart_service` is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

3. **Add a trust policy** pinning `repository_id`, `workflow_path`, and `environment`:

   ```bash
   harper add_oidc_trust \
     id=my-app-release \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=ci-deploy \
     claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
   ```

   - `repository_id` — immutable; survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.
   - `workflow_path` — Harper derives it from `workflow_ref` by removing the `@<ref>` suffix. Format: `<owner>/<repo>/<path>`.
   - `environment` — gates the ref. Without it, anyone who can push a branch can mint a token.
   - `audience` — must be the exact target URL with its port and a **trailing slash**.

4. **Configure the GitHub environment**. In the repository's **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern. Add required reviewers if a release needs approval.

5. **Store the target as a repository variable** (not a secret — it is not sensitive):

   ```bash
   gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
   ```

6. **For private repositories**, store a durable credential once from your machine. For a private repository (git-tag deploys), use a fine-grained personal access token with **Contents: read-only** scoped to the application repository. For GitHub Packages, use a token with the `read:packages` scope. Store it in Harper with `harper deploy setup=true`:

   For a private repository:

   ```bash
   harper deploy setup=true provider=github project=my-app
   ```

   For GitHub Packages, store a durable token with the `read:packages` scope in Harper once with `harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org`. The name is derived from the component and the host: `deploy.my-app.git.github.com` for the repository, `deploy.my-app.npm.pkg.github.com` for GitHub Packages. Reference it by name in the workflow — never the token itself. Add `credential=true` to the deploy command in the workflow.

### How OIDC Authentication Works in the Workflow

A job authenticates through the trust policy automatically — nothing in the workflow names the policy — when all four conditions hold:

1. The job declares `id-token: write`.
2. `HARPER_CLI_TARGET` equals the policy's `audience` (URL with port and trailing slash).
3. The run matches the policy's claims (repository, workflow file, branch/environment).
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the exchange. Remove any existing credential from the runner environment before enabling OIDC, or it keeps winning silently.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.

On success the CLI prints to stderr:

```
Requesting a GitHub Actions identity token for https://my-instance.harperdb.io:9925/...
Authenticated as 'ci-deploy' via OIDC trust policy 'my-app-prod'.
```

Diagnose a rejected exchange with `list_oidc_trust` and the instance's `oidc-trust` log. The server does not report which check failed.

### Diagnosing with `list_oidc_trust`

Run as `super_user`:

```bash
harper list_oidc_trust
```

Returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, `exchangeable`, and `invalid_reason` when applicable.

- **`invalid_reason`** — set when the policy cannot authenticate anyone (malformed, or the named user was deleted or deactivated). This is the fastest explanation for a rejected exchange. When two exchangeable policies can match the same token but give it a different user or operations, both carry `invalid_reason` naming the rival. Drop or disable one, or give them claims that keep them apart.
- **`exchangeable`** — `true` when the exchange considers the policy; `false` when disabled, malformed, or not specific enough (e.g., a GitHub Actions policy that pins no ref).

### Dropping a Policy with `drop_oidc_trust`

```bash
harper drop_oidc_trust id=my-app-prod
```

Fails with `404` if no policy has that `id`. Does not revoke tokens already issued — those remain valid for up to one hour. To stop an already-issued token, also run `alter_user`:

```bash
harper alter_user username=ci-deploy active=false
```

### Policy Specificity for GitHub Actions (`token.actions.githubusercontent.com`)

For this issuer, every policy must satisfy all three specificity requirements:

| Requirement            | Satisfied by                                                             | Left open otherwise                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **Pin the repository** | `repository_id`, `repository`                                            | Any repository                                  |
| **Pin the workflow**   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository                 |
| **Gate the ref**       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed to the repository |

Additional constraints:

- `repository_id` is preferred over `repository` because it is immutable and survives renames.
- `workflow_ref` pins workflow + ref together. Use for branch-triggered deploys, e.g. `my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`.
- `workflow_path` pins the workflow without the ref. Use for tag-triggered deploys combined with `environment`.
- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.

## Examples

### Path A: Deploy a Tagged Release (`v1.2.3`) from the Repository

Push a semver tag (`v1.2.3`), and every node clones and installs that commit. `by_ref=true` deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit even if the tag is moved later. Pass `ref=<sha>` to deploy a different commit. If the repository needs a build step to be runnable, do not reach for `install_allow_scripts` — use Path B instead.

```yaml
# .github/workflows/deploy.yml
name: Deploy to Harper
on:
  push:
    tags: ['v*']

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
      id-token: write
    env:
      HARPER_CLI_TARGET: ${{ vars.HARPER_CLI_TARGET }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 26
      - run: npm install --global harper@^5.3
      - name: Deploy the tagged commit
        run: harper deploy project=my-app by_ref=true restart=rolling json=true > deploy.json
      - name: Wait for every node to take the release
        run: |
          # From v5.4.0 a certified rolling deploy waited for every node itself.
          [ "$(jq -r '.rollout.status // empty' deploy.json)" != success ] || exit 0
          JOB_ID=$(jq -r '.restartJobId // empty' deploy.json)
          [ -n "$JOB_ID" ] || { echo "The rolling deploy returned no restartJobId"; exit 1; }
          LAST="could not be read"
          for attempt in $(seq 60); do
            sleep 10
            harper get_job id="$JOB_ID" json=true > job.json || continue
            case $(jq -r '.[0].status // "MISSING"' job.json) in
              COMPLETE) exit 0 ;;
              ERROR) jq -r '.[0].message' job.json; exit 1 ;;
              MISSING) LAST="was not on the node that answered; its outcome is unknown" ;;
              *) LAST="was still running" ;;
            esac
          done
          echo "After 60 polls, job $JOB_ID $LAST"
          exit 1
```

For a private repository, add `credential=true` to the deploy command.

Key details for Path A:

- **No secrets.** `HARPER_CLI_TARGET` is the only thing the workflow is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the trust policy requires into it.
- **`persist-credentials: false`** keeps the job's `GITHUB_TOKEN` out of `.git/config`, where `actions/checkout` otherwise leaves it for every later step. From v6 it saves the token in a file under `$RUNNER_TEMP` rather than in `.git/config`, which `harper deploy` uploads with the checkout, but later steps can still read it.
- **`harper@^5.3`** pins the CLI's major version. 5.3 is the first CLI that authenticates with the identity token.
- **`by_ref=true`** deploys `git+https://github.com/<owner>/<repo>.git#<sha>`. Pass `ref=<sha>`, with the full commit SHA, to deploy a different commit.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time. `restart=true` deploys to every node at once; each node replaces its workers a few at a time while the others keep serving.
- **`json=true`** prints the deploy's result as JSON on stdout. Progress and authentication messages go to stderr.
- **`restartJobId`** — present in the deploy JSON when a rolling restart job was started. Absent when `rollout.status` is already `success` (v5.4.0+ certified rolling deploy waited itself).
- **`.[0].status`** — the wait loop reads job status from `get_job`'s array response. An empty list means the job is not on the node that answered; the loop retries.
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects this. When `certification` is `unavailable`, the wait step must poll `restartJobId` with `get_job`.
- **`load-balanced` clusters**: Harper does not replicate jobs. Only the node that received the deploy knows the rolling job. Through a load-balanced cluster URL, polls from `get_job` must eventually reach that node. If your load balancer routes polls to a different node than the deploy, use one node's own URL for both the deploy and the wait, and as the trust policy's `audience`.

### Path B: Build in CI, Publish to GitHub Packages, Deploy the Artifact

Give `package.json` a scoped name and `"publishConfig": { "registry": "https://npm.pkg.github.com" }`:

```json
{
	"name": "@my-org/my-app",
	"version": "1.2.3",
	"publishConfig": { "registry": "https://npm.pkg.github.com" },
	"files": ["config.yaml", "schema.graphql", "dist/"]
}
```

The deploy installs the version the tag names, and `npm publish` publishes the version in `package.json`, so they must agree: `npm version 1.2.3` sets one and creates the other as `v1.2.3`.

```yaml
# .github/workflows/deploy.yml
name: Build, publish, and deploy to Harper
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 26
          registry-url: https://npm.pkg.github.com
          scope: '@my-org'
      - run: npm ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: npm run build
      - run: npm test
      - name: Publish to GitHub Packages
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  deploy:
    needs: publish
    runs-on: ubuntu-latest
    environment: production
    permissions:
      id-token: write
    env:
      HARPER_CLI_TARGET: ${{ vars.HARPER_CLI_TARGET }}
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 26
      - run: npm install --global harper@^5.3
      - name: Deploy the published version
        run: |
          harper deploy project=my-app package="@my-org/my-app@${GITHUB_REF_NAME#v}" \
            credentials='[{"registry":"https://npm.pkg.github.com","scope":"@my-org","secret":"deploy.my-app.npm.pkg.github.com"}]' \
            restart=rolling json=true > deploy.json
      - name: Wait for every node to take the release
        run: |
          # From v5.4.0 a certified rolling deploy waited for every node itself.
          [ "$(jq -r '.rollout.status // empty' deploy.json)" != success ] || exit 0
          JOB_ID=$(jq -r '.restartJobId // empty' deploy.json)
          [ -n "$JOB_ID" ] || { echo "The rolling deploy returned no restartJobId"; exit 1; }
          LAST="could not be read"
          for attempt in $(seq 60); do
            sleep 10
            harper get_job id="$JOB_ID" json=true > job.json || continue
            case $(jq -r '.[0].status // "MISSING"' job.json) in
              COMPLETE) exit 0 ;;
              ERROR) jq -r '.[0].message' job.json; exit 1 ;;
              MISSING) LAST="was not on the node that answered; its outcome is unknown" ;;
              *) LAST="was still running" ;;
            esac
          done
          echo "After 60 polls, job $JOB_ID $LAST"
          exit 1
```

The workflow has two jobs so the job that can request an identity token runs none of your code:

- **`publish`** installs, builds, tests and publishes, with `contents: read` and `packages: write` only. It cannot request an identity token.
- **`deploy`** runs once `publish` has finished (`needs: publish`), and holds the `production` environment and `id-token: write`. It installs only the Harper CLI, then deploys the published version. The trust policy still matches it: only this job names the environment, so only its token carries the `environment` claim the policy requires.

### Check the Deployment Record

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

Go back to a previous release by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. Use `list_deployments` to see the history of what was deployed and when, and filter by commit with `sha`.

## Notes

- **`vars.HARPER_CLI_TARGET`** is a repository variable, not a secret. The target URL is not sensitive.
- **`id-token: write`** must appear on the specific job that runs `harper` commands, not only at the workflow level.
- **Trailing slash** in `audience` is required. The CLI requests its token for the exact target URL including port and trailing slash.
- **`enabled`** — setup never writes a policy that already exists, so it cannot undo a disable. A policy that is disabled shows `enabled: false` in `list_oidc_trust`.
- **`drop_oidc_trust` does not revoke tokens already issued.** A minted JWT is valid for one hour. To stop a token already in circulation, also run `harper alter_user username=<project>-ci-deploy active=false`.
- **`invalid_reason`** on a `list_oidc_trust` entry is the fastest diagnostic for a rejected exchange. The exchange server does not report which check failed.
- **`workflow=`** must point to a `.yml` or `.yaml` file inside `.github/workflows/`. If the file is not committed in the checkout when setup runs, the policy uses defaults regardless of your actual workflow.
- **`environment: production`** on the deploy job is what puts the `environment` claim into the OIDC token. Without it the trust policy's `environment` claim cannot match.
- **`actions/checkout`** with `persist-credentials: false` prevents the job's `GITHUB_TOKEN` from being saved where later steps or uploaded content can read it.
- **`npm install --global harper@^5.3`** pins the CLI's major version. 5.3 is the first CLI that authenticates with the identity token.
- **`runs-on: ubuntu-latest`** satisfies the git ≥ 2.31 requirement for git-host credentials. Windows nodes are not supported for git credentials.
- **`push:` / `tags: ['v*']`** — tag-triggered workflows cannot use `workflow_ref` in the trust policy. Use `workflow_path` + `environment` instead.
- **`jobs:`** — split build/publish and deploy into separate jobs so the job with `id-token: write` runs none of the repository's build code.
- **`add_oidc_trust`** replaces a policy with the same `id`. Setup checks for a conflicting policy just before writing, but a policy created by another `super_user` in that moment could still be overwritten.
- **`token.actions.githubusercontent.com`** — for this issuer, every policy must satisfy all three specificity requirements: pin the repository, pin the workflow, and gate the ref.
- **`repository_id`** is preferred over `repository` because it is immutable and survives renames.
- **`<project>-ci-deploy`** — the user and role name setup creates. This user can deploy any component on the cluster; access control comes down to who can merge to the branch (or push a matching tag).
- **`registration_info`** — omitting it from the role still allows deploys, but the cluster logs a refused operation on every run.
- **`oidc-trust`** — the instance log stream to check when diagnosing exchange failures.
- **`alter_user`** — use `harper alter_user username=<project>-ci-deploy active=false` to immediately invalidate the user, stopping tokens already issued from authorizing further operations.
- **`super_user`** — both `list_oidc_trust` and `drop_oidc_trust` require `super_user`. Setup must also be run as `super_user`.
- **`credential=true`** — add to the deploy command for private repositories to attach the stored git credential (`deploy.my-app.git.github.com`).
