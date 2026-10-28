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
  sourceCommit: 76b79e7af77b88d0f18a539d4de5cf898a340ded
  inputHash: a289613c23da3297
---

# Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to configure OIDC trusted publishing so a GitHub Actions workflow can deploy to Harper with no stored credential, using `harper deploy setup=true provider=github-actions`.

## When to Use

Apply this rule when wiring up a GitHub Actions workflow to deploy a Harper application without storing a `HARPER_CLI_REFRESH_TOKEN` or any other durable credential in CI. Use it when setting up a new pipeline, rotating access, or diagnosing a rejected OIDC exchange.

## How It Works

### One-command setup (branch-triggered deploys)

1. **Run setup once** from the project's checkout, signed in as a `super_user`:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app
   ```

   If your workflow file is not `.github/workflows/deploy.yaml`, pass `workflow=` explicitly — otherwise the policy pins `deploy.yaml` and runs of your workflow can't match it:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
   ```

2. **What setup does automatically:**
   - Resolves the GitHub repository's numeric id and canonical name from the `origin` remote (or `repo=<owner>/<name>`). Pass `repository_id=<id>` for private repos without `gh`.
   - Validates the workflow file: it must be able to run on `main` (or `branch=`), run a job in the `production` environment (`environment=`), and grant `id-token: write`. Setup stops before writing anything if the workflow could never match or never request a token.
   - Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_job`, and `registration_info`, and a trust policy named `github-actions-<project>`.
   - Reads the policy back and compares it claim by claim with what it intended to write.
   - Sets the repository's `HARPER_CLI_TARGET` variable via `gh` if one doesn't already exist.

3. **Understand the limits of setup:**
   - Setup only creates — running it again leaves the cluster and variable unchanged.
   - A role, user, or policy that already exists but differs stops setup before it writes anything.
   - To replace a policy: `harper drop_oidc_trust id=github-actions-<project>`, then run setup again.
   - The policy pins one branch, so it suits merge-triggered deploys. **Tag-triggered deploys require a manually written policy** (see below).

---

### Manual setup (tag-triggered deploys)

For workflows that deploy on version tags, `workflow_ref` can't be pinned because the tag is unknown at policy-write time. Instead, pin `workflow_path` and gate on a GitHub environment.

1. **Log in as `super_user`:**

   ```bash
   harper login https://my-cluster.example.com:9925
   ```

2. **Create a deploy-only role and user:**

   ```bash
   harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
   harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
   ```

   - `deploy_component` — the deploy itself.
   - `get_job` — required for the wait step; without it the wait step fails with `403`.
   - `get_deployment` — reads the deployment record.
   - `registration_info` — version check `harper deploy` makes before uploading.
   - `restart_service` is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

3. **Add a trust policy** with `add_oidc_trust`:

   ```bash
   harper add_oidc_trust \
     id=my-app-release \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=ci-deploy \
     claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
   ```

   Key claim details:
   - `repository_id` — immutable; survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.
   - `workflow_path` — derived from `workflow_ref` by removing the `@<ref>` suffix; format is `<owner>/<repo>/<path>`.
   - `environment` — required ref gate. Without it, anyone who can push a branch can mint a token.
   - `audience` — must be the exact target URL with its port and a **trailing slash**.
   - A workflow that deploys on a push to `main` can pin `workflow_ref` (`my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`) instead, which gates the ref by itself.

4. **Configure the GitHub environment.** In the repository's **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern. Add required reviewers if a release needs approval.

5. **Store the target as a repository variable** (not a secret):

   ```bash
   gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
   ```

---

### How OIDC authentication works in the workflow

A job with `id-token: write` asks GitHub for an identity token. The Harper CLI trades that token for a one-hour operation token when all four conditions hold:

1. The job declares `permissions: id-token: write`.
2. `HARPER_CLI_TARGET` equals the policy's `audience` — the target URL with port and trailing slash.
3. The run matches the policy's claims: `repository_id`, `workflow_path`, and `environment`.
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the exchange.

Nothing in the workflow names the policy. Every `harper` command in the job authenticates through it automatically.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.

On success the CLI prints to stderr which policy authenticated it and as whom:

```
Requesting a GitHub Actions identity token for https://my-instance.harperdb.io:9925/...
Authenticated as 'ci-deploy' via OIDC trust policy 'my-app-prod'.
```

---

### Policy specificity requirements for GitHub Actions

For `https://token.actions.githubusercontent.com`, every policy must satisfy all three:

| Requirement            | Satisfied by                                                             | Left open otherwise             |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| **Pin the repository** | `repository_id`, `repository`                                            | Any repository                  |
| **Pin the workflow**   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository |
| **Gate the ref**       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed   |

- `repository_id` is preferred over `repository` — it is immutable.
- A tag-triggered release cannot pin `workflow_ref`; pin `workflow_path` and gate on `environment`.
- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.

---

### Durable credential for a private source

If deploying from a private repository, store a durable token (not the ephemeral `GITHUB_TOKEN`) once from your machine. Use a fine-grained personal access token with **Contents: read-only** for a private repository, or a token with the `read:packages` scope for GitHub Packages.

Store it in Harper once with `harper deploy setup=true`:

```bash
harper deploy setup=true provider=github project=my-app
```

For GitHub Packages:

```bash
harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org
```

The name is derived from the component and the host: `deploy.my-app.git.github.com` for the repository, and `deploy.my-app.npm.pkg.github.com` for GitHub Packages. Reference it by that name in the workflow — the token never appears in your pipeline.

---

### Managing trust policies

| Operation                              | Command                                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| List all policies (including disabled) | `harper list_oidc_trust`                                      |
| Drop a policy                          | `harper drop_oidc_trust id=github-actions-<project>`          |
| Deactivate the deploy user             | `harper alter_user username=<project>-ci-deploy active=false` |

`list_oidc_trust` returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, and optionally `invalid_reason`. Check `invalid_reason` first when diagnosing a rejected exchange — it is set when the policy is malformed or the user it names was deleted or deactivated. Use the instance's `oidc-trust` log for further diagnosis.

Dropping a policy stops future runs but does not revoke already-issued tokens (valid for one hour). To stop a token already in circulation, also run `harper alter_user` to deactivate the user.

## Examples

### Path A: Deploy a Tagged Release (`v1.2.3`) from the Repository

Push a semver tag (`v1.2.3`), and every node clones and installs that commit. `by_ref=true` deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit even if the tag is moved later. If the repository needs a build step to be runnable, use Path B instead — don't reach for `install_allow_scripts`.

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
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --global harper@^5.3
      - name: Deploy the tagged commit
        run: harper deploy project=my-app by_ref=true restart=rolling json=true > deploy.json
      - name: Wait for every node to take the release
        run: |
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

For a private repository, add `credential=true` to the deploy command to attach the stored `deploy.my-app.git.github.com` credential.

Key details:

- **No secrets.** `HARPER_CLI_TARGET` is the only thing the workflow is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the trust policy requires into it.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time. Use `restart=true` for a single-node or dev instance.
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects whether canary certification ran. With `restart=rolling`, the node you called certifies it before the deploy responds, and each other node certifies it as the job reaches it.
- **`json=true`** prints the deploy's result as JSON on stdout. Progress and authentication messages go to stderr, so `deploy.json` holds only the result.
- **The wait step** polls `restartJobId` with `get_job` until the job ends `COMPLETE` or `ERROR`. It retries a poll that fails, such as one that reaches a node while it restarts, and gives up after 60 polls (about ten minutes).
- **The job lives on one node.** Through a **load-balanced** cluster URL, polls must eventually reach that node. Routing that always sends polls to a different node than the deploy causes the wait step to report the job was not on the node that answered and its outcome is unknown, even when the rollout succeeded. If your load balancer routes that way, use one node's own URL for both the deploy and the wait, and as the trust policy's `audience`.

---

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
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
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
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install --global harper@^5.3
      - name: Deploy the published version
        run: |
          harper deploy project=my-app package="@my-org/my-app@${GITHUB_REF_NAME#v}" \
            credentials='[{"registry":"https://npm.pkg.github.com","scope":"@my-org","secret":"deploy.my-app.npm.pkg.github.com"}]' \
            restart=rolling json=true > deploy.json
      - name: Wait for every node to take the release
        run: |
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

The two-job structure ensures the job with `id-token: write` runs none of the repository's build code. Two credentials play different roles:

- **Publishing** and installing private `@my-org` dependencies with `npm ci` use the workflow's ephemeral `GITHUB_TOKEN`. Both happen entirely inside the `publish` job.
- **Installing on Harper nodes** uses the durable `read:packages` token stored as `deploy.my-app.npm.pkg.github.com` — because installs can happen long after this workflow ends.

---

### Check the deployment record

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

Only the node you called writes that record, so with `restart=rolling` on v5.4.0 and later it can report `success` before the job has visited the other nodes, and keeps reporting it if one of them rejects the release. Wait on the job, not the record, to learn whether every node took the release. `list_deployments` gives you the history of what was deployed and when.

## Notes

- `HARPER_CLI_TARGET` is a repository **variable** (`vars.HARPER_CLI_TARGET`), not a secret — it is not sensitive.
- `HARPER_CLI_REFRESH_TOKEN` and any other configured credential outrank the OIDC exchange. Remove stored credentials from the pipeline before enabling OIDC.
- `npm install --global harper@^5.3` pins the CLI's major version — 5.3 is the first CLI that authenticates with the identity token.
- `persist-credentials: false` keeps the job's `GITHUB_TOKEN` out of `.git/config`, where `actions/checkout` otherwise leaves it for every later step.
- `runs-on: ubuntu-latest` is used in all example jobs.
- `push:` / `tags: ['v*']` triggers the workflow on version tags.
- The `jobs:` key separates `publish` and `deploy` in Path B to isolate `id-token: write` from build code.
- `.[0].status` is the field the wait loop reads from `get_job` output.
- `restartJobId` is the field the wait loop reads from `deploy.json`.
- **Go back to a previous release** by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. To deploy a release that is no longer kept, re-run the deploy with its tag or version.
- **Revoking the pipeline's access**: drop the trust policy with `drop_oidc_trust`, or deactivate the deploy user with `alter_user`. There is no CI secret to rotate.
- Git-host credentials require git ≥ 2.31 on the Harper nodes and are not supported on Windows nodes. Registry credentials have no such constraints.
- See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for cluster-specific deployment details.
