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
  sourceCommit: e69702c99845f2dd810cb32652d1a9e6b58c538b
  inputHash: 91e58cd0833af162
---

# Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to configure and use OIDC trusted publishing so a GitHub Actions workflow can deploy to Harper with no stored credential.

## When to Use

Apply this rule when wiring up a GitHub Actions workflow to deploy a Harper application without storing a `HARPER_CLI_REFRESH_TOKEN` or any other durable credential in CI. Use it both for the one-command setup path (branch-triggered deploys) and for the manual policy path (tag-triggered releases). Also apply it when diagnosing a rejected OIDC exchange or revoking pipeline access.

## How It Works

### One-Command Setup (branch-triggered deploys)

1. **Run setup once** from the project's checkout, signed in as a `super_user`:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app
   ```

   If your workflow file is not `.github/workflows/deploy.yaml`, pass `workflow=`:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
   ```

2. **Understand what setup does** — it executes these steps automatically:
   - Resolves the GitHub repository's numeric `repository_id` from the `origin` remote (or `repo=<owner>/<name>`). Pass `repository_id=<id>` explicitly for private repos without `gh`.
   - Validates the workflow file: it must be able to run on `main` (or `branch=`), run a job in the `production` environment (`environment=`), and grant `id-token: write`. Setup stops before writing anything if the workflow could never match or never request a token.
   - Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_deployment`, `get_job`, and `registration_info`, plus the trust policy `github-actions-<project>`.
   - Reads the policy back and compares it claim by claim.
   - Sets the repository's `HARPER_CLI_TARGET` variable via `gh` if one does not already exist.

3. **Handle idempotency**: setup only creates — it never overwrites. A role, user, or policy that already exists but differs stops setup before writing. To replace a policy:

   ```bash
   harper drop_oidc_trust id=github-actions-<project>
   ```

   Then run setup again.

---

### Manual Setup (tag-triggered deploys)

Use this path when the workflow deploys on version tags, because a branch pin cannot match a tag ref.

1. **Log in as `super_user`**:

   ```bash
   harper login https://my-cluster.example.com:9925
   ```

2. **Create a deploy-only role and user** named `<project>-ci-deploy`:

   ```bash
   harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
   harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
   ```

   - `deploy_component` — the deploy itself.
   - `get_deployment` — required for `harper deploy restart=rolling` to wait on every node; without it that wait fails with `403`.
   - `get_job` — required for the wait step; without it the wait step fails with `403`.
   - `registration_info` — version check before upload; omitting it logs a refused operation on every run.
   - `restart_service` is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

3. **Add a trust policy** pinning `repository_id`, `workflow_path`, and `environment` (use this shape for tag-triggered workflows where `workflow_ref` cannot be pinned):

   ```bash
   harper add_oidc_trust \
     id=my-app-release \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=ci-deploy \
     claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
   ```

   Key claim rules:
   - `repository_id` is immutable and survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.
   - `workflow_path` is derived from `workflow_ref` by removing the `@<ref>` suffix; format is `<owner>/<repo>/<path>`.
   - `environment` is the ref gate. Without it, anyone who can push a branch can mint a token.
   - `audience` must be the exact target URL with its port and a **trailing slash**.
   - A workflow that deploys on a push to `main` can pin `workflow_ref` (`my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`) instead, which gates the ref by itself.

4. **Configure the GitHub environment**: in **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern. Add required reviewers if a release needs approval.

5. **Store the target as a repository variable** (not a secret):

   ```bash
   gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
   ```

---

### How OIDC Authentication Works in the Workflow

A job authenticates automatically when all four conditions hold:

1. **The job declares `permissions: id-token: write`.**
2. **`HARPER_CLI_TARGET` is the policy's `audience`.** The CLI requests its token for the target it connects to, so the target must be the URL the policy names, with its port and trailing slash. It is not sensitive, so use `vars.HARPER_CLI_TARGET` rather than a secret.
3. **The run matches the policy's claims**: its `repository_id`, `workflow_path`/`workflow_ref`, and `environment`.
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the exchange.

Nothing in the workflow names the policy. Every `harper` command in the job (`harper deploy`, `harper get_job`, etc.) authenticates through it automatically.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.

---

### Policy Specificity for GitHub Actions

For `issuer=https://token.actions.githubusercontent.com`, every policy must satisfy all three requirements:

| Requirement            | Satisfied by one of                                                      | Left open otherwise                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **Pin the repository** | `repository_id`, `repository`                                            | Any repository                                  |
| **Pin the workflow**   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository                 |
| **Gate the ref**       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed to the repository |

Additional constraints:

- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.

---

### Diagnosing a Rejected Exchange

Run `list_oidc_trust` (requires `super_user`) to list all policies including disabled ones:

```json
{ "operation": "list_oidc_trust" }
```

`list_oidc_trust` returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, and optionally `invalid_reason`. Check `invalid_reason` first when diagnosing a rejected exchange — it is set when the policy is malformed or its user was deleted or deactivated after the policy was written. The exchange itself will not report what failed.

Check the instance's `oidc-trust` log for server-side detail.

---

### Revoking Pipeline Access

- **Stop future runs** — drop the policy:

  ```bash
  harper drop_oidc_trust id=github-actions-<project>
  ```

  This does not revoke tokens already issued (they are stateless JWTs valid for one hour).

- **Stop a token already in circulation** — deactivate the user:

  ```bash
  harper alter_user username=<project>-ci-deploy active=false
  ```

  Use both together when responding to a suspected compromise.

---

### Providing a Durable Credential for a Private Source

Do not use the workflow's ephemeral `GITHUB_TOKEN` for Harper's stored credential — it expires when the job ends, and later installs (a new node joining, a reinstall after restore) would fail. Instead use a durable token:

- For a private repository: a fine-grained personal access token with **Contents: read-only** scoped to the application repository.
- For GitHub Packages: a token with the `read:packages` scope.

Store it in Harper once from your machine:

```bash
# Private git repository
harper deploy setup=true provider=github project=my-app

# GitHub Packages
harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org
```

The name is derived from the component and the host: `deploy.my-app.git.github.com` for the repository, and `deploy.my-app.npm.pkg.github.com` for GitHub Packages. Reference it by that name in the workflow — the token never appears in your pipeline.

## Examples

### Path A: Deploy a Tagged Release (`v1.2.3`) from the Repository

Push a semver tag (`v1.2.3`), and every node clones and installs that commit. `by_ref=true` deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit even if the tag is moved later. If this repository needs a build step to be runnable, do not reach for `install_allow_scripts` — use Path B instead.

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

Key details:

- **No secrets.** `HARPER_CLI_TARGET` is the only thing the workflow is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the trust policy requires into it.
- **`persist-credentials: false`** keeps the job's `GITHUB_TOKEN` out of `.git/config`, where `actions/checkout` otherwise leaves it for every later step.
- **`harper@^5.3`** pins the CLI's major version. 5.3 is the first CLI that authenticates with the identity token.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time so the cluster keeps serving throughout. Use `restart=true` for a single-node or dev instance.
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects whether this ran.
- **`restartJobId`**: present in the deploy JSON when a rolling job was started but the deploy did not wait for it itself. The wait step polls `.[0].status` from `get_job` until `COMPLETE` or `ERROR`.
- **Load-balanced clusters**: the deployment record wait works through a load-balanced URL (the record replicates), but `get_job` polls do not — Harper does not replicate jobs. If your load balancer never routes back to the node that received the deploy, use one node's direct URL for both the deploy and the wait, and as the trust policy's `audience`.

For a private repository, add `credential=true` to the deploy command.

---

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

Split into two jobs so the job with `id-token: write` runs none of your build code. Only the `deploy` job names `environment: production`, so only its token carries the `environment` claim the trust policy requires.

---

### Checking the Deployment Record

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

Use `list_deployments` to see the history of what was deployed and when, and filter by commit with `sha`.

- **Go back to a previous release** by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. To deploy a release that is no longer kept, re-run the deploy with its tag or version.

## Notes

- `audience` in `add_oidc_trust` must include the port and a **trailing slash** — e.g., `https://my-cluster.example.com:9925/`. A URL without the trailing slash will not match.
- `HARPER_CLI_REFRESH_TOKEN` and any other configured credential (`auth_username=`/`auth_password=`, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_OPERATION_TOKEN`, a saved `harper login`) outrank the OIDC exchange. Remove stored credentials from the runner before enabling OIDC.
- `list_oidc_trust`, `drop_oidc_trust`, and `alter_user` all require `super_user`.
- `drop_oidc_trust` does not revoke already-issued operation tokens (one-hour JWTs). Pair it with `alter_user username=<project>-ci-deploy active=false` to stop tokens already in circulation.
- `ref_type: tag` is not accepted as a ref gate. Gate tag-triggered workflows with `environment` instead, and set **Deployment branches and tags** to `v*` in the environment's settings.
- Every step in a job with `id-token: write` can request an identity token — GitHub gives each one `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`. Run none of the repository's code in that job.
- See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for cluster-level deployment context.
