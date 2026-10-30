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
  sourceCommit: fc17e9ddb92ad5a1ecc193e6017b680643a4a19b
  inputHash: 9144f099fbd31da4
---

# Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to configure OIDC trusted publishing so a GitHub Actions workflow can deploy to Harper with no stored credential, using `harper deploy setup=true provider=github-actions` and hand-written policies for tag-triggered releases.

## When to Use

Apply this rule when wiring up a GitHub Actions workflow to deploy a Harper application without storing a `HARPER_CLI_REFRESH_TOKEN` or any other durable credential in CI. Use it for both the one-command branch-deploy setup and the manual policy approach required for tag-triggered releases.

## How It Works

### One-Command Setup (Branch Deploys)

1. **Run setup once** from the project's checkout, signed in as a `super_user`:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app
   ```

   If your workflow file is not `.github/workflows/deploy.yaml`, pass its path explicitly with `workflow=`; otherwise the policy pins `deploy.yaml` and runs of your workflow cannot match it:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
   ```

2. **Understand what setup does** — it performs these steps in order:
   - Resolves the GitHub repository from the checkout's `origin` remote (or `repo=<owner>/<name>`), fetching its numeric id and canonical spelling. For a private repository without `gh`, pass `repository_id=<id>` explicitly.
   - Validates the workflow file: it must be able to run on `main` (or `branch=`), have a job in the `production` environment (or `environment=`), and grant `id-token: write`. A workflow that can never match stops setup before anything is written. Conditions setup cannot decide are reported as not verified.
   - Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_deployment`, `get_job`, and `registration_info`, plus the trust policy `github-actions-<project>`.
   - Reads the policy back and compares it claim by claim with what was written.
   - Sets the repository's `HARPER_CLI_TARGET` variable via `gh` if one does not already exist.

3. **Handle idempotency**: setup only creates — running it again leaves the cluster and variable unchanged. A role, user, or policy that already exists but differs stops setup before writing. To replace a policy, drop it first:

   ```bash
   harper drop_oidc_trust id=github-actions-<project>
   ```

   Then run setup again.

4. **Revoke access when needed**:
   - Drop the trust policy to stop new runs: `harper drop_oidc_trust id=github-actions-<project>`
   - Deactivate the user to also invalidate already-issued tokens (valid up to one hour): `harper alter_user username=<project>-ci-deploy active=false`

---

### Manual Setup (Tag-Triggered Releases)

A workflow that deploys on tags needs a policy written by hand because the tag is part of `workflow_ref` and is unknown when the policy is written. See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for cluster-level context.

1. **Log in as `super_user`**:

   ```bash
   harper login https://my-cluster.example.com:9925
   ```

2. **Create a deploy-only role and user**:

   ```bash
   harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
   harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
   ```

   - `deploy_component` — the deploy itself.
   - `get_deployment` — required for `harper deploy restart=rolling` to wait on every node; without it that wait fails with `403`.
   - `get_job` — what the wait step polls when the deploy did not wait itself; without it the wait step fails with `403`.
   - `registration_info` — version check `harper deploy` makes before uploading; without it the deploy still works but the cluster logs a refused operation on every run.
   - `restart_service` is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

3. **Add a trust policy** pinning `repository_id`, `workflow_path`, and `environment` (not `workflow_ref`, since the tag is unknown):

   ```bash
   harper add_oidc_trust \
     id=my-app-release \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=ci-deploy \
     claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
   ```

   - `repository_id` is immutable and survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.
   - `workflow_path` is derived from `workflow_ref` by removing the `@<ref>` suffix; format is `<owner>/<repo>/<path>`.
   - `environment` gates the ref. Without it, anyone who can push a branch could mint a token.
   - `audience` must be the exact target URL with its port and a **trailing slash**.
   - A workflow that deploys on a push to `main` can pin `workflow_ref` (`my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`) instead, which gates the ref by itself.

4. **Configure the GitHub environment**: in **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern. Add required reviewers if a release needs approval.

5. **Store the target as a repository variable** (not a secret — it is not sensitive):

   ```bash
   gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
   ```

---

### How OIDC Authentication Works in the Workflow

A job with `id-token: write` asks GitHub for an identity token. The Harper CLI trades it for a one-hour operation token when all four conditions hold:

1. The job declares `permissions: id-token: write`.
2. `HARPER_CLI_TARGET` equals the policy's `audience` (URL with port and trailing slash).
3. The run matches the policy's claims: `repository_id`, `workflow_path`/`workflow_ref`, and `environment`.
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the exchange.

Nothing in the workflow names the policy. Every `harper` command in the job (`harper deploy`, `harper get_job`, etc.) authenticates through it automatically.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.

On success the CLI prints to stderr:

```
Requesting a GitHub Actions identity token for https://my-instance.harperdb.io:9925/...
Authenticated as 'ci-deploy' via OIDC trust policy 'my-app-prod'.
```

To diagnose a rejected exchange, use `list_oidc_trust` and check the instance's `oidc-trust` log. The server does not report which check failed.

---

### Policy Specificity for GitHub Actions

For `https://token.actions.githubusercontent.com`, a policy must satisfy all three of these:

| Requirement            | Satisfied by one of                                                      | Left open otherwise                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **Pin the repository** | `repository_id`, `repository`                                            | Any repository                                  |
| **Pin the workflow**   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository                 |
| **Gate the ref**       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed to the repository |

Additional constraints:

- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.
- `repository_id` is preferred over `repository` because it is immutable.
- A tag-triggered release cannot pin `workflow_ref` since the tag is unknown when the policy is written — pin `workflow_path` and gate on `environment` instead.

---

### Diagnosing and Managing Policies

- **List all policies** (including disabled ones) — `super_user` only:

  ```bash
  harper list_oidc_trust
  ```

  `list_oidc_trust` returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, and optionally `invalid_reason`. Check `invalid_reason` first when diagnosing a rejected exchange — it is set when the policy is malformed or its user was deleted or deactivated after the policy was written.

- **Drop a policy** — stops future exchanges; does not revoke already-issued tokens:

  ```bash
  harper drop_oidc_trust id=my-app-release
  ```

  To also stop tokens already in circulation, deactivate the user with `harper alter_user`.

---

### Durable Credentials for Private Sources

Skip this section if your repository is public or your package is on a public registry.

Harper keeps the credential (encrypted, in the secrets store) with the component's configuration so that later installs — a new node joining the cluster, a reinstall after a restore — can fetch the package again. Use a durable token, not the workflow's ephemeral `GITHUB_TOKEN`.

- For a private repository (git-tag deploys): a fine-grained personal access token with **Contents: read-only** permission scoped to the application repository.
- For GitHub Packages: a token with the `read:packages` scope.

Store it in Harper once from your machine:

```bash
# For a private repository:
harper deploy setup=true provider=github project=my-app

# For GitHub Packages:
harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org
```

The name is derived from the component and the host: `deploy.my-app.git.github.com` for the repository, and `deploy.my-app.npm.pkg.github.com` for GitHub Packages. Reference it by that name in the workflow — the token never appears in your pipeline.

---

### Checking the Deployment Record

`deploy.json` carries a `deployment_id`. Read the deployment record with:

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

- Go back to a previous release by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. To deploy a release that is no longer kept, re-run the deploy with its tag or version.
- Use `list_deployments` to see the history of what was deployed and when, and filter by commit with `sha`.

## Examples

### Path A: Deploy a Tagged Release (`v1.2.3`) from the Repository

Push a semver tag (`v1.2.3`), and every node clones and installs that commit. `by_ref=true` deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit even if the tag is moved later. If this repository needs a build step to be runnable, stop — don't reach for `install_allow_scripts`. Use Path B instead.

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

For a private repository, add `credential=true` to the deploy command to attach the `deploy.my-app.git.github.com` reference.

Key details:

- **No secrets.** `HARPER_CLI_TARGET` is the only thing the workflow is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the trust policy requires into it.
- **`persist-credentials: false`** keeps the job's `GITHUB_TOKEN` out of `.git/config`, where `actions/checkout` otherwise leaves it for every later step.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time so the cluster keeps serving throughout. Use `restart=true` for a single-node or dev instance.
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects whether this ran.
- **`load-balanced` clusters**: the rolling restart job lives on one node. `get_job` polls through a load-balanced URL may reach a node that did not receive the deploy and return an empty list. If your load balancer routes that way, use one node's own URL for both the deploy and the wait, and as the trust policy's `audience`.
- **`.[0].status`** is the field the wait step reads from `get_job` output to determine `COMPLETE`, `ERROR`, or still running.
- **`restartJobId`** is the field in `deploy.json` the wait step uses to identify the rolling restart job to poll.

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

Note the two credentials play different roles:

- **Publishing** and installing private `@my-org` dependencies with `npm ci` use the workflow's ephemeral `GITHUB_TOKEN`. Both happen entirely inside the `publish` job, so an ephemeral token is exactly right.
- **Installing on Harper nodes** uses the durable `read:packages` token stored as `deploy.my-app.npm.pkg.github.com` — because installs can happen long after this workflow ends.

## Notes

- **`id-token: write`** must appear on the specific job that runs `harper` commands. Every step in that job can request an identity token — run none of the repository's code in it.
- **`vars.HARPER_CLI_TARGET`** is a repository variable, not a secret. The URL is not sensitive.
- **`HARPER_CLI_REFRESH_TOKEN`** and any other configured credential outrank the OIDC exchange. Remove stored credentials from the workflow before enabling OIDC.
- **`npm install --global harper@^5.3`** pins the CLI's major version. 5.3 is the first CLI that authenticates with the identity token.
- **`runs-on: ubuntu-latest`** is required for the wait-step shell logic shown above.
- **`push:` / `tags: ['v*']`** triggers the workflow on version tags.
- **`jobs:`** structure matters for security: separate `publish` and `deploy` jobs so the job with `id-token: write` runs none of the repository's build code.
- **`add_oidc_trust`** replaces a policy with the same `id`. Setup checks just before writing, but a policy created by another `super_user` in that moment would still be overwritten.
- **`deploy_component`** in the role allows deploying any component on the cluster, not only the named project. Access control comes down to who can merge to the branch or push a matching tag.
- **`token.actions.githubusercontent.com`** is the required `issuer` value for GitHub Actions OIDC policies.
- **`environment: production`** on the job puts the `environment` claim into the identity token. Without it the token carries no environment claim and cannot match a policy that requires one.
- **`Deployment branches and tags`**: set this in **Settings → Environments → production** to `v*` to restrict which tags can deploy.
- **`alter_user`** deactivates a user and stops already-issued tokens from authorizing further operations. Use it alongside `drop_oidc_trust` when responding to a suspected compromise.
- **`invalid_reason`** on a `list_oidc_trust` entry means the policy cannot authenticate anyone — check it first when diagnosing a rejected exchange.
- **`github-actions-<project>`** is the trust policy id setup creates.
- **`<project>-ci-deploy`** is the user name setup creates. It can deploy any component on the cluster.
