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
  sourceCommit: 2dde0597443a13af0c753f2adbe528e8442d8ee4
  inputHash: b235eb6a7fb4d9a1
---

# Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to configure and execute credential-free Harper deployments from GitHub Actions using OIDC trusted publishing, including one-command setup and complete workflow examples.

## When to Use

Apply this rule when asked to deploy from CI, to set up or fix a deploy workflow (including the `.github/workflows/deploy.yaml` that create-harper projects ship), or to move a pipeline off a stored Harper credential such as `HARPER_CLI_REFRESH_TOKEN`. Use it when setting up OIDC trust for the first time, writing or debugging a deploy workflow, or revoking/rotating pipeline access.

## How It Works

### One-Command Setup (Branch-Based Deploys)

1. **Run setup once** from the project checkout, signed in as a `super_user`:

   ```bash
   harper login https://my-cluster.example.com:9925
   harper deploy setup=true provider=github-actions project=my-app
   ```

   If your workflow file is not `.github/workflows/deploy.yaml`, pass `workflow=` explicitly — otherwise the policy pins `deploy.yaml` and runs of your workflow cannot match it:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
   ```

2. **Understand what setup does** — in order:
   - Resolves the GitHub repository's numeric id and canonical name from the `origin` remote (or `repo=<owner>/<name>`). Pass `repository_id=<id>` when the API is unavailable (e.g., private repo without `gh`).
   - **The workflow is checked before anything is written.** It must be able to run on `main` (`branch=`) and run a job in the `production` environment (`environment=`) with `permissions: id-token: write`; one that never could stops setup. What it can't decide is reported as not verified.
   - Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_job`, and `registration_info`, and a trust policy named `github-actions-<project>`.
   - Reads the policy back and compares it claim by claim with what it intended to write.
   - Sets the repository's `HARPER_CLI_TARGET` Actions variable via `gh` if one does not already exist.

3. **Handle idempotency**: setup only creates — it never updates. A role, user, or policy that already exists but differs stops setup and names what differs. To replace a policy:

   ```bash
   harper drop_oidc_trust id=github-actions-<project>
   harper deploy setup=true provider=github-actions project=my-app
   ```

### Manual Setup (Tag-Based or Custom Deploys)

Use this path when deploying on version tags, because a branch-pinned policy cannot match a tag ref.

1. **Create a deploy-only role and user**:

   ```bash
   harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
   harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
   ```

   - `deploy_component` — the deploy itself.
   - `get_job` — required for the wait step; an `operations` allowlist refuses anything not listed, so without it the wait step fails with `403`.
   - `get_deployment` — reads the deployment record.
   - `registration_info` — version check `harper deploy` makes before uploading.
   - `restart_service` is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

2. **Add a trust policy** pinned to `repository_id`, `workflow_path`, and `environment` (use this shape when the tag is unknown at policy-write time):

   ```bash
   harper add_oidc_trust \
     id=my-app-release \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=ci-deploy \
     claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
   ```

   Key claim rules:
   - `repository_id` is immutable — survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.
   - `workflow_path` pins the workflow file. Harper derives it from the token's `workflow_ref` by removing the `@<ref>` suffix, so it is `<owner>/<repo>/<path>`.
   - `environment` is the ref gate. Without it, anyone who can push a branch can mint a token.
   - `audience` must be the exact target URL with its port and a **trailing slash**.
   - A workflow that deploys on a push to `main` can pin `workflow_ref` (`my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`) instead, which gates the ref by itself.

3. **Configure the GitHub environment**: in **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern. Add required reviewers if a release needs approval.

4. **Store the target as a repository variable** (not a secret — it is not sensitive):

   ```bash
   gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
   ```

### How OIDC Authentication Works in the Workflow

Once a trust policy exists, every `harper` command in the deploy job authenticates through it automatically when all four conditions hold:

1. **The job may request an identity token.** On GitHub Actions that is `permissions: id-token: write` on the job.
2. **`HARPER_CLI_TARGET` is the policy's `audience`.** The CLI requests its token for the target it connects to, so the target must be the URL the policy names, with its port and trailing slash. Use `vars.HARPER_CLI_TARGET` — it is not sensitive, so a repository variable rather than a secret.
3. **The run matches the policy's claims**: its repository, its workflow file and branch, and its environment.
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the exchange.

What each command may then do is up to the role of the user the policy names: a role that lists only `deploy_component`, `get_job` and `registration_info`, like the one setup creates, refuses anything else with a `403`.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.

Nothing in the workflow names the policy. The CLI prints to stderr which policy authenticated it and as whom:

```
Requesting a GitHub Actions identity token for https://my-instance.harperdb.io:9925/...
Authenticated as 'ci-deploy' via OIDC trust policy 'my-app-prod'.
```

Diagnose a rejected exchange with `list_oidc_trust` (check for `invalid_reason` on each entry) and the instance's `oidc-trust` log. The server deliberately does not report which check failed.

### Policy Specificity for GitHub Actions

For `https://token.actions.githubusercontent.com`, a policy must satisfy all three of these:

| Requirement            | Satisfied by one of                                                      | Left open otherwise                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **Pin the repository** | `repository_id`, `repository`                                            | Any repository                                  |
| **Pin the workflow**   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository                 |
| **Gate the ref**       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed to the repository |

Additional constraints:

- `repository_id` is preferred over `repository` — it is immutable and survives renames.
- A tag-triggered release cannot pin `workflow_ref` since the tag is unknown when the policy is written. Pin `workflow_path` and gate on `environment`.
- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.

### Revoking Access

- **Stop future runs**: `harper drop_oidc_trust id=github-actions-<project>` (does not revoke already-issued tokens, which are valid up to one hour).
- **Stop an already-issued token**: `harper alter_user username=<project>-ci-deploy active=false`.
- **No CI secret to rotate** — there is none.

## Examples

### Path A: Deploy a Tagged Release (`v1.2.3`) from the Repository

Push a semver tag (`v1.2.3`), and every node clones and installs that commit. `by_ref=true` deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit even if the tag moves later. For a private repository, add `credential=true` to attach the stored credential (`deploy.my-app.git.github.com`). If the repository needs a build step to be runnable, don't reach for `install_allow_scripts`: use Path B.

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

Key details:

- **No secrets.** `HARPER_CLI_TARGET` is the only thing the workflow is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the trust policy requires into it.
- **`persist-credentials: false`** keeps the job's `GITHUB_TOKEN` out of `.git/config`.
- **`harper@^5.3`** pins the CLI's major version. 5.3 is the first CLI that authenticates with the identity token.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time. Use `restart=true` for a single-node or dev instance.
- **`json=true`** prints the deploy's result as JSON on stdout; progress and authentication messages go to stderr.
- **The wait step** polls `restartJobId` via `get_job` until `COMPLETE` or `ERROR`, checking `.[0].status`. It retries a poll that fails (such as one that reaches a node while it restarts) and gives up after 60 polls (~10 minutes).
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects this. With `restart=rolling` on v5.4.0 and later, the deploy can report `success` before the rolling job has visited all nodes — wait on the job, not the record.
- **The job lives on one node.** Through a **load-balanced** cluster URL, polls must eventually reach that node. Routing that always sends polls to a different node than the deploy causes the wait step to fail saying the job was not on the node that answered.

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

Two jobs keep the identity token isolated: `publish` installs, builds, tests and publishes with `contents: read` and `packages: write` only — it cannot request an identity token. `deploy` runs once `publish` finishes (`needs: publish`), holds `environment: production` and `id-token: write`, and installs only the Harper CLI before deploying.

Credential roles:

- **Publishing** and installing private `@my-org` dependencies use the workflow's ephemeral `GITHUB_TOKEN` (`packages: write` includes read). Both happen entirely inside `publish`.
- **Installing on Harper nodes** uses the durable `read:packages` token stored as `deploy.my-app.npm.pkg.github.com` — because installs can happen long after this workflow ends.

For `my-app`, the credential names are `deploy.my-app.git.github.com` for the repository and `deploy.my-app.npm.pkg.github.com` for GitHub Packages. Store a durable credential once from your machine:

```bash
harper deploy setup=true provider=github project=my-app
# or for GitHub Packages:
harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org
```

For a private repository, use a GitHub fine-grained personal access token with **Contents: read-only** scoped to the application repository. For GitHub Packages, use a token with the `read:packages` scope. Do not use the workflow's ephemeral `GITHUB_TOKEN` for the durable credential — it expires when the job ends.

### Check the Deployment Record

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

Only the node you called writes that record, so with `restart=rolling` on v5.4.0 and later it can report `success` before the job has visited the other nodes, and keeps reporting it if one of them rejects the release. Wait on the job, not the record, to confirm all nodes took the release. `list_deployments` gives the history of what was deployed and when.

### List and Inspect Trust Policies

```bash
harper list_oidc_trust
```

Returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, and optionally `invalid_reason`. Check `invalid_reason` first when diagnosing a rejected exchange — it is set when the policy is malformed or its user was deleted or deactivated.

### Drop a Trust Policy

```bash
harper drop_oidc_trust id=github-actions-<project>
```

## Notes

- `HARPER_CLI_REFRESH_TOKEN` and any other stored credential outrank the OIDC exchange. Remove them from the workflow if switching to OIDC.
- **Go back to a previous release** by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. To deploy a release that is no longer kept, re-run the deploy with its tag or version.
- **Rotating the deploy credential**: run `harper deploy setup=true` again with the same name and a new value. The pipeline doesn't change.
- **Revoking the pipeline's access**: `harper drop_oidc_trust` stops new runs; `harper alter_user` also stops a token already issued (valid up to one hour).
- The `<project>-ci-deploy` user created by setup can deploy any component on the cluster, not only the named project. Access control comes down to who can merge to the branch.
- The `audience` in `add_oidc_trust` must be the exact target URL with its port and a trailing slash.
- For tag-triggered workflows, `provider=github-actions` setup is not sufficient — it pins a branch. Write the policy manually using `add_oidc_trust` with `workflow_path` and `environment` claims.
- `token.actions.githubusercontent.com` is the required `issuer` value for GitHub Actions OIDC policies.
- Git-host credentials require git ≥ 2.31 on the Harper nodes and are not supported on Windows nodes. Registry credentials have no such constraints.
- See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for cluster-level deployment context.
