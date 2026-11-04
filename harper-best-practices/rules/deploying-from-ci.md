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
  sourceCommit: 6cd8a2ea6372924486aac46a5d96ba00c10eff07
  inputHash: e56285cb04eaf135
---

# Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to follow when setting up and executing Harper deployments from GitHub Actions using OIDC trusted publishing, so no Harper credential is stored in CI.

## When to Use

Apply this rule when wiring a GitHub Actions workflow to deploy a Harper application without storing a `HARPER_CLI_REFRESH_TOKEN` or any other durable Harper credential in CI. Use it when running `harper deploy setup=true provider=github-actions` for the first time, when writing or debugging a deploy workflow, or when managing OIDC trust policies on the cluster.

## How It Works

### 1. One-command cluster setup (branch-triggered deploys)

Run once from the project's checkout, signed in as a `super_user` (`harper login`):

```bash
harper deploy setup=true provider=github-actions project=my-app
```

If your workflow file is not `.github/workflows/deploy.yaml`, pass `workflow=`:

```bash
harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
```

The command does the following automatically:

1. Resolves the GitHub repository from the `origin` remote (or `repo=<owner>/<name>`), fetching its numeric id and canonical name. For a private repository without `gh`, pass `repository_id=<id>` explicitly.
2. Validates the workflow file: it must be able to run on `main` (or `branch=`), have a job in the `production` environment (or `environment=`), and declare `permissions: id-token: write`. Checks that cannot be decided (branch patterns, scheduled triggers, reusable workflows) are reported as not verified.
3. Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_deployment`, `get_job`, and `registration_info`, plus a trust policy named `github-actions-<project>`. The policy's `audience` is the target URL with its port and a trailing slash.
4. Reads the policy back and compares it claim by claim with what was written.
5. Sets the repository's `HARPER_CLI_TARGET` variable via `gh` if one does not already exist.

Setup only creates — it never overwrites. Re-running it leaves the cluster and variable unchanged. A role, user, or policy that already exists but differs stops setup before writing anything.

To replace a policy, drop it first then re-run setup:

```bash
harper drop_oidc_trust id=github-actions-<project>
harper deploy setup=true provider=github-actions project=my-app
```

To revoke pipeline access:

```bash
harper drop_oidc_trust id=github-actions-<project>
harper alter_user username=<project>-ci-deploy active=false
```

`drop_oidc_trust` stops new exchanges. `alter_user active=false` also invalidates tokens already issued (which last one hour).

### 2. Manual setup (tag-triggered deploys)

A workflow that deploys on version tags cannot use `provider=github-actions` setup because the tag is unknown when the policy is written. Create the role, user, and policy by hand.

**Create a deploy-only role and user:**

```bash
harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
```

- `deploy_component` is the deploy itself.
- `get_deployment` — required for `harper deploy restart=rolling` to wait on every node; without it that wait fails with `403`.
- `get_job` is what the wait step polls when the deploy did not wait itself. Without it the wait step fails with `403`.
- `registration_info` returns only Harper's version, which `harper deploy` checks before it uploads.
- `restart_service` is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

**Add a trust policy pinned to the workflow file and `production` environment:**

```bash
harper add_oidc_trust \
  id=my-app-release \
  issuer=https://token.actions.githubusercontent.com \
  audience=https://my-cluster.example.com:9925/ \
  user=ci-deploy \
  claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
```

Key claim decisions:

| Claim           | Purpose                       | Notes                                                                                               |
| --------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `repository_id` | Pins the repository immutably | Survives renames; look up with `gh api repos/my-org/my-app --jq .id`                                |
| `workflow_path` | Pins the workflow file        | Derived from `workflow_ref` by removing the `@<ref>` suffix; format is `<owner>/<repo>/<path>`      |
| `environment`   | Gates the ref                 | Without it, anyone who can push a branch can mint a token                                           |
| `workflow_ref`  | Pins workflow + ref together  | Use for branch-triggered deploys, e.g. `my-org/my-app/.github/workflows/deploy.yml@refs/heads/main` |

- A workflow that deploys on a push to `main` can pin `workflow_ref` (`my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`) instead, which gates the ref by itself.
- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.

The `audience` must be the exact target URL with its port and a trailing slash.

**Configure the `production` environment in GitHub:** go to Settings → Environments → production, set **Deployment branches and tags** to the `v*` tag pattern, and add required reviewers if a release needs approval.

**Store the target as a repository variable (not a secret):**

```bash
gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
```

### 3. How OIDC authentication works in the workflow

A job with `id-token: write` requests a GitHub identity token. The Harper CLI trades it for a one-hour operation token when all four conditions hold:

1. The job declares `permissions: id-token: write`.
2. `HARPER_CLI_TARGET` equals the policy's `audience` (with port and trailing slash).
3. The run matches the policy's claims (repository, workflow, environment).
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the OIDC exchange.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.

Nothing in the workflow names the policy. Every `harper` command in the job (`harper deploy`, `harper get_job`, etc.) authenticates through it automatically.

On success the CLI prints to stderr:

```
Requesting a GitHub Actions identity token for https://my-instance.harperdb.io:9925/...
Authenticated as 'ci-deploy' via OIDC trust policy 'my-app-prod'.
```

Diagnose a rejected exchange with `list_oidc_trust` and the instance's `oidc-trust` log — the server does not report which check failed.

### 4. Manage and audit trust policies

**List all policies (including disabled ones) — `super_user` only:**

```bash
harper list_oidc_trust
```

Returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, `exchangeable`, and `invalid_reason` when applicable.

Check `invalid_reason` first when diagnosing a rejected exchange. It is set when the policy is malformed or when the user it names was deleted or deactivated. When two exchangeable policies can match the same token but give it a different user or operations, both carry `invalid_reason` naming the rival. Resolve by dropping or disabling one, or giving them non-overlapping claims.

**Drop a policy — `super_user` only:**

```bash
harper drop_oidc_trust id=my-app-prod
```

Fails with `404` if no policy has that `id`. Does not revoke tokens already issued — those remain valid for up to one hour. To stop an already-issued token, also run `alter_user`.

## Examples

### Path A: Deploy a Tagged Release (`v1.2.3`) from the Repository

Push a semver tag (`v1.2.3`), and every node clones and installs that commit. `by_ref=true` deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit even if the tag is moved later. If your repository needs a build step to be runnable, use Path B instead — don't reach for `install_allow_scripts`.

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

For a private repository, add `credential=true` to the deploy command. It attaches the `deploy.my-app.git.github.com` reference created with `harper deploy setup=true`.

Key details:

- **No secrets.** `HARPER_CLI_TARGET` is the only thing the workflow is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the trust policy requires into it.
- **`persist-credentials: false`** keeps the job's `GITHUB_TOKEN` out of `.git/config`, where `actions/checkout` otherwise leaves it for every later step. From v6 it saves the token in a file under `$RUNNER_TEMP` rather than in `.git/config`, which `harper deploy` uploads with the checkout, but later steps can still read it.
- **`harper@^5.3`** pins the CLI's major version. 5.3 is the first CLI that authenticates with the identity token.
- **`by_ref=true`** deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`). Pass `ref=<sha>` to deploy a different commit.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time. `restart=true` deploys to every node at once; each node replaces its workers a few at a time while the others keep serving.
- **`json=true`** prints the deploy's result as JSON on stdout. Progress and authentication messages go to stderr.
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects this; when it is `unavailable`, the certified wait path is skipped.
- **`restartJobId`**: present in `deploy.json` when the deploy started a rolling restart job but did not wait for it itself. The wait step polls this id with `get_job` and checks `.[0].status` for `COMPLETE`, `ERROR`, or `MISSING`.
- **The job lives on one node.** Harper does not replicate jobs, so only the node that received the deploy knows the rolling job. Through a load-balanced cluster URL, at least one poll must reach that node. If your load balancer routes polls to a different node than the deploy, use one node's own URL for both the deploy and the wait, and as the trust policy's `audience`.
- Go back to a previous release by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. Use `list_deployments` to see the history of what was deployed and when, and filter by commit with `sha`.

### Path B: Build in CI, Publish to GitHub Packages, Deploy the Artifact

The flow: push a tag → CI builds and tests → `npm publish` to GitHub Packages → `harper deploy` installs the published version from the registry.

Give `package.json` a scoped name and `"publishConfig": { "registry": "https://npm.pkg.github.com" }`:

```json
{
	"name": "@my-org/my-app",
	"version": "1.2.3",
	"publishConfig": { "registry": "https://npm.pkg.github.com" },
	"files": ["config.yaml", "schema.graphql", "dist/"]
}
```

For GitHub Packages, store a durable token with the `read:packages` scope in Harper once with `harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org`. The name is derived from the component and the host — for `my-app` it is `deploy.my-app.npm.pkg.github.com`. The deploy step references it by that name, so the token never appears in the pipeline.

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

Split into two jobs so the job with `id-token: write` runs none of the repository's build code:

- **`publish`** installs, builds, tests, and publishes with `contents: read` and `packages: write` only. It cannot request an identity token.
- **`deploy`** runs once `publish` has finished (`needs: publish`), holds `environment: production` and `id-token: write`, installs only the Harper CLI, and deploys the published version. Only this job names the environment, so only its token carries the `environment` claim the policy requires.

### Check the deployment record

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

Use `list_deployments` to see the history of what was deployed and when, and filter by commit with `sha`.

## Notes

- **`trailing slash`**: the `audience` in the trust policy and `HARPER_CLI_TARGET` must be the full URL with port and trailing slash, e.g. `https://my-cluster.example.com:9925/`.
- **`HARPER_CLI_REFRESH_TOKEN`**: if this or any other credential (`HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_OPERATION_TOKEN`, `auth_username=`/`auth_password=`, credentials in the target URL, or a saved `harper login`) is present, it outranks the OIDC exchange. Remove it from the workflow before enabling OIDC.
- **`drop_oidc_trust` does not revoke already-issued tokens.** Tokens are stateless JWTs valid for one hour. To stop a token already in circulation, also run `harper alter_user username=<project>-ci-deploy active=false`.
- **`invalid_reason`** on a policy from `list_oidc_trust` is the fastest explanation for a rejected exchange — the exchange itself does not report which check failed. Also check the instance's `oidc-trust` log.
- **`load-balanced` clusters**: Harper does not replicate jobs. Only the node that received the deploy knows the rolling job. Routing that sends `get_job` polls to a different node than the deploy causes the wait step to report the job was not on the node that answered, even when the rollout succeeded.
- **Policy specificity for `token.actions.githubusercontent.com`**: every policy must pin the repository (`repository_id`), pin the workflow (`workflow_ref`, `workflow_path`, `job_workflow_ref`, or `job_workflow_path`), and gate the ref (`workflow_ref`, `ref`, or `environment`). A policy missing any of these is rejected as not specific enough; its `invalid_reason` says why.

See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for cluster-level deployment configuration on Harper Fabric.
