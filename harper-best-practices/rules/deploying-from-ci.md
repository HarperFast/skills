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
  sourceCommit: 489477b2259ba148f4e526ea4b5cd24041ceec03
  inputHash: e56285cb04eaf135
---

# Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to configure OIDC trusted publishing so a GitHub Actions workflow can deploy to Harper with no stored credential.

## When to Use

Apply this rule when setting up a GitHub Actions workflow to deploy a Harper application using OIDC identity tokens instead of stored secrets. Use it when running `harper deploy setup=true provider=github-actions` for the first time, when writing or debugging a deploy workflow, or when managing trust policies, deploy users, and rolling restarts.

## How It Works

### 1. Run one-command setup as a `super_user`

Log in to the cluster, then run setup from the project's checkout:

```bash
harper login https://my-cluster.example.com:9925
harper deploy setup=true provider=github-actions project=my-app
```

If your workflow file is not `.github/workflows/deploy.yaml`, pass `workflow=` explicitly — the policy pins the exact filename, and runs of a differently named workflow will never match:

```bash
harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
```

Setup performs these steps automatically:

1. Resolves the GitHub repository's numeric id and canonical name from the `origin` remote (or `repo=<owner>/<name>`). Pass `repository_id=<id>` for private repositories without `gh`.
2. Validates the workflow file: it must be able to run on `main` (or `branch=`), run a job in the `production` environment (`environment=`), and grant `permissions: id-token: write`. Setup stops before writing anything if the workflow could never match or never request a token.
3. Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_deployment`, `get_job`, and `registration_info`, plus the trust policy `github-actions-<project>`.
4. Reads the policy back and compares it claim by claim with what it intended to write.
5. Sets the repository's `HARPER_CLI_TARGET` variable via `gh` if one does not already exist.

### 2. Understand what setup creates

| Object        | Name                       | Purpose                              |
| ------------- | -------------------------- | ------------------------------------ |
| Role + user   | `<project>-ci-deploy`      | Privilege boundary for CI runs       |
| Trust policy  | `github-actions-<project>` | Maps OIDC claims to the deploy user  |
| Repo variable | `HARPER_CLI_TARGET`        | Points every workflow at the cluster |

The policy's `audience` is the target URL with its port and a **trailing slash** (e.g. `https://my-cluster.example.com:9925/`). The claims include `repository_id`, `workflow_ref`, and `environment`.

### 3. Create a deploy-only user manually (alternative to setup)

If you need to configure manually — for example, for a tag-triggered workflow that cannot use a branch pin — create the role and user yourself:

```bash
harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
```

- **`deploy_component`** — the deploy itself.
- **`get_deployment`** — required for `harper deploy restart=rolling` to wait on every node; without it the wait fails with `403`.
- **`get_job`** — required for the wait step that polls `restartJobId`; without it the wait fails with `403`.
- **`registration_info`** — version check before upload; without it the deploy still works but logs a refused operation.
- **`restart_service`** is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

### 4. Add a trust policy manually (tag-triggered workflows)

Tag-triggered workflows cannot pin `workflow_ref` because the tag is unknown at policy-write time. Pin `workflow_path` and gate on `environment` instead:

```bash
harper add_oidc_trust \
  id=my-app-release \
  issuer=https://token.actions.githubusercontent.com \
  audience=https://my-cluster.example.com:9925/ \
  user=ci-deploy \
  claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
```

- **`repository_id`** — immutable; survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.
- **`workflow_path`** — Harper derives it from `workflow_ref` by removing the `@<ref>` suffix; format is `<owner>/<repo>/<path>`.
- **`environment`** — the ref gate. Without one, anyone who can push a branch could run the pinned workflow on it and mint a token. In the repository's **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern.
- **`audience`** — must be the exact target URL with port and **trailing slash**.
- **`workflow_ref`** pins workflow and ref together. Use for branch-triggered deploys, e.g. `my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`.

Store the target as a repository variable (not a secret):

```bash
gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
```

### 5. Configure the workflow job for OIDC

Every `harper` command in the job authenticates through the trust policy automatically when all four conditions hold:

1. The job declares `id-token: write`.
2. `HARPER_CLI_TARGET` equals the policy's `audience` (with port and trailing slash).
3. The run matches the policy's claims (repository, workflow file, branch/environment).
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the exchange.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than failing.

### 6. Store a durable credential for private sources

Skip this step if your repository is public or your package is on a public registry.

For a private repository (git-tag deploys), store a fine-grained personal access token with **Contents: read-only** scoped to the application repository:

```bash
harper deploy setup=true provider=github project=my-app
```

For GitHub Packages, store a durable token with the `read:packages` scope:

```bash
harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org
```

The name is derived from the component and the host: `deploy.my-app.git.github.com` for the repository, and `deploy.my-app.npm.pkg.github.com` for GitHub Packages. The workflows reference it by that name — the token never appears in the pipeline.

### 7. Write the deploy workflow

**Path A — deploy a tagged release (`v1.2.3`) from the repository:**

Push a semver tag (`v1.2.3`), and every node clones and installs that commit. `by_ref=true` deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit. Pass `ref=<sha>` with the full commit SHA to deploy a different commit. If the repository needs a build step to be runnable, use Path B instead — do not reach for `install_allow_scripts`.

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

- **`persist-credentials: false`** keeps the job's `GITHUB_TOKEN` out of `.git/config`, where `actions/checkout` otherwise leaves it for every later step. From v6 it saves the token in a file under `$RUNNER_TEMP` rather than in `.git/config`, which `harper deploy` uploads with the checkout, but later steps can still read it.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time. `restart=true` deploys to every node at once; each node replaces its workers a few at a time while the others keep serving.
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects whether this ran; when it is `unavailable`, the certified wait is skipped.
- **`json=true`** prints the deploy result as JSON on stdout. Progress and authentication messages go to stderr.
- **Waiting for every node**: with `restart=rolling` on v5.4.0 and later, unless `certification` is `unavailable`, `harper deploy` waits for every node on the deployment record before it exits. Its result then carries `rollout`, and the wait step does nothing. Otherwise the wait step polls `restartJobId` with `get_job` until `COMPLETE` or `ERROR`, retrying polls that fail (such as one that reaches a node while it restarts). It gives up after 60 polls (~10 minutes).
- **The job lives on one node.** Harper does not replicate jobs, so only the node that received the deploy knows the rolling job. Through a **load-balanced** cluster URL, at least one poll must reach that node. Routing that sends polls to a different node than the deploy causes the step to fail, saying the job was not on the node that answered and its outcome is unknown. If your load balancer routes that way, use one node's own URL for both the deploy and the wait, and as the trust policy's `audience`.

**Path B — build in CI, publish to GitHub Packages, deploy the artifact:**

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

- **`publish`** installs, builds, tests, and publishes with `contents: read` and `packages: write` only. It cannot request an identity token.
- **`deploy`** runs once `publish` has finished (`needs: publish`), holds the `production` environment and `id-token: write`, installs only the Harper CLI, then deploys the published version.

### 8. Manage trust policies

**List all policies** (including disabled ones) — `super_user` only:

```bash
harper list_oidc_trust
```

Returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, `invalid_reason`, and `exchangeable`. Check `invalid_reason` first when diagnosing a rejected exchange — the exchange itself does not report which check failed. Diagnose further with the instance's `oidc-trust` log.

**Drop a policy** to stop future runs from exchanging — `super_user` only:

```bash
harper drop_oidc_trust id=github-actions-<project>
```

Fails with `404` if no policy has that `id`. Does not revoke already-issued tokens (valid for one hour). To also stop a token already in circulation, deactivate the user:

```bash
harper alter_user username=<project>-ci-deploy active=false
```

**Replace a policy**: drop it with `harper drop_oidc_trust id=github-actions-<project>`, then run setup again. Setup never overwrites an existing policy.

## Examples

**Minimal OIDC-authenticated deploy job (branch-triggered, setup already run):**

```yaml
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
    - run: npm install --global harper@^5.3
    - run: harper deploy project=my-app restart=rolling
```

**Check the deployment record after a deploy:**

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

**Go back to a previous release** by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. Use `list_deployments` to see the history of what was deployed and when, and filter by commit with `sha`.

**Revoke pipeline access:**

```bash
harper drop_oidc_trust id=github-actions-<project>
harper alter_user username=<project>-ci-deploy active=false
```

## Notes

- The `audience` in every trust policy and in `HARPER_CLI_TARGET` must include the port and a **trailing slash** — `https://my-cluster.example.com:9925/`. A missing trailing slash causes the exchange to fail.
- `HARPER_CLI_REFRESH_TOKEN` and any other stored credential outrank the OIDC exchange. Remove them from the workflow if you are switching to OIDC.
- `harper@^5.3` pins the CLI major version. 5.3 is the first version that authenticates with an identity token.
- `runs-on: ubuntu-latest` is used in all example workflows. The git-credential helper for private repositories requires git ≥ 2.31 and is not supported on Windows nodes.
- Policy specificity for `https://token.actions.githubusercontent.com` requires all three of:

  | Requirement            | Satisfied by one of                                                      | Left open otherwise                             |
  | ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
  | **Pin the repository** | `repository_id`, `repository`                                            | Any repository                                  |
  | **Pin the workflow**   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository                 |
  | **Gate the ref**       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed to the repository |

- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.
- Two `exchangeable` policies that can match the same runs but give them a different user or operations cause the exchange to refuse those runs. Both will carry `invalid_reason`. Drop or disable one, or give them non-overlapping claims.
- `add_oidc_trust` replaces a policy with the same `id`. Setup checks for conflicts immediately before writing, but a policy created by another `super_user` in that instant could still be overwritten.
- See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for cluster-level deployment configuration on Harper Fabric.
