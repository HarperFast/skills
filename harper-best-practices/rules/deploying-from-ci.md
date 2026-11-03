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
  sourceCommit: 62139d5475bb9993c3aa6bc8d23420ea7610f739
  inputHash: 4c8540f0a9990f14
---

# Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to configure OIDC trusted publishing so a GitHub Actions workflow can deploy to Harper with no stored credential.

## When to Use

Apply this rule when wiring up a GitHub Actions workflow to deploy a Harper application without storing a `HARPER_CLI_REFRESH_TOKEN` or any other durable credential in CI. Use it when setting up a new pipeline, rotating access, or diagnosing a rejected OIDC exchange.

## How It Works

### One-command setup (branch-triggered deploys)

Run once from the project checkout, signed in as a `super_user`:

```bash
harper login https://my-cluster.example.com:9925
harper deploy setup=true provider=github-actions project=my-app
```

If your workflow file is not `.github/workflows/deploy.yaml`, pass `workflow=`:

```bash
harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
```

The command:

1. Resolves the GitHub repository's numeric id and canonical name from the `origin` remote (or `repo=<owner>/<name>`). Pass `repository_id=<id>` explicitly for private repos without `gh`. Look up the id with `gh api repos/my-org/my-app --jq .id`.
2. Validates the workflow file: it must be reachable on `main` (or `branch=`), have a job in the `production` environment (or `environment=`), and grant `permissions: id-token: write`. Checks that cannot be decided (branch patterns, scheduled triggers, reusable workflows) are reported as not verified.
3. Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_deployment`, `get_job`, and `registration_info`, plus a trust policy named `github-actions-<project>`.
4. Reads the policy back and compares it claim by claim with what it intended to write.
5. Sets the repository's `HARPER_CLI_TARGET` variable via `gh`. If the variable already points to a different cluster, setup prints the command to change it and exits non-zero.

Setup only creates — it never overwrites. To replace a policy, drop it first:

```bash
harper drop_oidc_trust id=github-actions-<project>
```

Then run setup again.

---

### Manual setup (tag-triggered deploys)

Tag-triggered workflows cannot pin `workflow_ref` because the tag is unknown at policy-write time. Create the role, user, and policy by hand.

**1. Create a deploy-only role and user:**

```bash
harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
```

- `deploy_component` — the deploy itself.
- `get_deployment` — required for `harper deploy restart=rolling` to wait on every node; without it that wait fails with `403`.
- `get_job` — required for the wait-step polling loop; without it the wait step fails with `403`.
- `registration_info` — version check before upload; omitting it logs a refused operation on every run.
- `restart_service` is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

**2. Add a trust policy pinned to the workflow file and environment:**

```bash
harper add_oidc_trust \
  id=my-app-release \
  issuer=https://token.actions.githubusercontent.com \
  audience=https://my-cluster.example.com:9925/ \
  user=ci-deploy \
  claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
```

Key claim fields:

| Claim           | Purpose                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `repository_id` | Immutable repository pin; survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.                      |
| `workflow_path` | Pins the workflow file; derived from `workflow_ref` by removing the `@<ref>` suffix; format is `<owner>/<repo>/<path>`. |
| `environment`   | Ref gate; without it any branch push can mint a token.                                                                  |

- `audience` must be the exact target URL with its port and a **trailing slash**.
- In the GitHub repository's **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern.
- A workflow that deploys on a push to `main` can pin `workflow_ref` (`my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`) instead, which gates the ref by itself.

**3. Store the target as a repository variable (not a secret):**

```bash
gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
```

---

### How OIDC authentication works in the workflow

Every `harper` command in a job authenticates through the trust policy automatically when all four conditions hold:

1. **The job declares `permissions: id-token: write`.**
2. **`HARPER_CLI_TARGET` is the policy's `audience`.** The CLI requests its token for the target it connects to, so the target must be the URL the policy names, with its port and trailing slash. It is not sensitive, so use `vars.HARPER_CLI_TARGET` rather than a secret.
3. **The run matches the policy's claims**: its `repository_id`, `workflow_path`/`workflow_ref`, and `environment`.
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the OIDC exchange.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.

On success the CLI prints to stderr:

```
Requesting a GitHub Actions identity token for https://my-instance.harperdb.io:9925/...
Authenticated as 'ci-deploy' via OIDC trust policy 'my-app-prod'.
```

Diagnose a rejected exchange with `list_oidc_trust` and the instance's `oidc-trust` log. The server does not report which check failed.

---

### Revoking access

- **Stop future runs:** `harper drop_oidc_trust id=github-actions-<project>`
- **Also invalidate tokens already issued:** `harper alter_user username=<project>-ci-deploy active=false` — a minted JWT is valid for one hour; dropping the policy alone does not revoke it.

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

Key details:

- **No secrets.** `HARPER_CLI_TARGET` is the only thing the workflow is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the trust policy requires into it.
- **`persist-credentials: false`** keeps the job's `GITHUB_TOKEN` out of `.git/config`, where `actions/checkout` otherwise leaves it for every later step. From v6 it saves the token in a file under `$RUNNER_TEMP` rather than in `.git/config`, which `harper deploy` uploads with the checkout, but later steps can still read it.
- **`npm install --global harper@^5.3`** pins the CLI's major version; 5.3 is the minimum that supports OIDC authentication.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time. `restart=true` deploys to every node at once.
- **`json=true`** prints the deploy's result as JSON on stdout; progress and authentication messages go to stderr.
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects whether this ran.
- **The job lives on one node.** Harper does not replicate jobs. Through a **load-balanced** cluster URL, at least one `get_job` poll must reach the node that received the deploy. If your load balancer routes polls to a different node, use one node's direct URL for both the deploy and the wait, and as the trust policy's `audience`. See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for multi-node deployment considerations.

---

### Path B — Build in CI, publish to GitHub Packages, deploy the artifact

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

For GitHub Packages, store a durable token with the `read:packages` scope in Harper once with `harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org`. The name is derived from the component and the host: `deploy.my-app.git.github.com` for the repository, and `deploy.my-app.npm.pkg.github.com` for GitHub Packages. Reference it by that name in the workflow — the token never appears in your pipeline. The workflow's ephemeral `GITHUB_TOKEN` is right for publishing and `npm ci` inside the job, but installs that happen after the workflow ends need the durable token.

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

The two-job structure is intentional: only `deploy` holds `id-token: write` and `environment: production`, so only its token carries the `environment` claim the trust policy requires. The `publish` job runs all repository code and cannot request an identity token.

---

### Checking the deployment record

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

`list_oidc_trust` returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, and optionally `invalid_reason`. Check `invalid_reason` first when diagnosing a rejected exchange — it is set when the policy cannot authenticate anyone because it is malformed or because the named user was deleted or deactivated:

```bash
harper list_oidc_trust
```

- Go back to a previous release by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. To deploy a release that is no longer kept, re-run the deploy with its tag or version.
- Use `list_deployments` to see the history of what was deployed and when, and filter by commit with `sha`.

## Notes

- `audience` in `add_oidc_trust` must exactly match `HARPER_CLI_TARGET`: the full URL with port and **trailing slash**. A mismatch silently prevents the exchange.
- `HARPER_CLI_REFRESH_TOKEN` and any other configured credential outrank the OIDC exchange. Remove stored credentials from the runner before enabling OIDC.
- The `<project>-ci-deploy` user can deploy **any component** on the cluster, not only the named project. Access control comes down to who can merge to the protected branch or push a `v*` tag.
- Policy specificity for `token.actions.githubusercontent.com` requires all three: pin the repository (`repository_id`), pin the workflow (`workflow_ref`, `workflow_path`, `job_workflow_ref`, or `job_workflow_path`), and gate the ref (`workflow_ref`, `ref`, or `environment`).

  | Requirement            | Satisfied by one of                                                      | Left open otherwise                             |
  | ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
  | **Pin the repository** | `repository_id`, `repository`                                            | Any repository                                  |
  | **Pin the workflow**   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository                 |
  | **Gate the ref**       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed to the repository |

- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.
- `repository_id` is immutable and survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.
- `drop_oidc_trust` stops future exchanges but does not revoke tokens already issued. Follow it with `alter_user username=<project>-ci-deploy active=false` when responding to a suspected compromise.
