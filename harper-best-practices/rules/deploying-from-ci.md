---
name: deploying-from-ci
description: >-
  How to deploy a Harper application from GitHub Actions with OIDC trusted
  publishing, so CI stores no Harper credential.
metadata:
  mode: generate
  sources:
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
  sourceCommit: e73e5efb2823cc52caf7a6458d67fbcff3bbff2c
  inputHash: dafad0b4dfe96417
---

# Deploying from CI

Instructions for the agent to follow when setting up a GitHub Actions workflow that deploys a Harper application with OIDC workload identity, so the pipeline stores no Harper credential.

## When to Use

Apply this rule when asked to deploy from CI, to add or fix a deploy workflow, or to move a pipeline off a stored Harper credential such as `HARPER_CLI_REFRESH_TOKEN` or a username and password. Harper detects GitHub Actions' identity token only; on another CI system, the CLI falls through to its other credential sources. For restart modes, `certification`, and rolling back by `deployment_id`, see [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md).

## How It Works

1. **Create a deploy-only user, once, as a super_user**: A job that declares `id-token: write` asks GitHub for an identity token saying which repository, workflow, and environment it runs for, and the CLI trades it for a one-hour operation token if it matches a trust policy on the cluster. The user that policy names is the privilege boundary: a matching run gets that user's role. A pipeline does not need `super_user`, so give it a role that lists only the operations the workflow calls:

   ```bash
   harper login https://my-cluster.example.com:9925
   harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment"]}'
   harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
   ```

   - `deploy_component` is the deploy itself, and `get_deployment` reads the deployment record.
   - `get_job` is what the wait step polls (step 4). An `operations` allowlist refuses every operation it doesn't list, so without it the wait step fails with `403`.
   - `restart_service` is not needed: Harper starts the rolling restart's job itself.
   - The password is required to create the user, but the pipeline never uses it, so this command discards it.
   - Deploying is still administrative authority, because the deployed component runs inside the Harper process. A deploy that passes a literal `token` in `credentials` needs `super_user`, so this role deploys a private source through a `secret` reference (step 3).

2. **Add a trust policy**: `add_oidc_trust`, `list_oidc_trust` and `drop_oidc_trust` are **super_user only**. A workflow that runs on a pushed version tag can't pin `workflow_ref`, because the tag is part of it and isn't known when you write the policy. Pin the repository and the workflow file instead, and gate on a GitHub environment:

   ```bash
   harper add_oidc_trust \
     id=my-app-release \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=ci-deploy \
     claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
   ```

   - **`repository_id`** pins the repository, and survives a rename. Look it up with `gh api repos/my-org/my-app --jq .id`.
   - **`workflow_path`** pins the workflow file. Harper derives it from the token's `workflow_ref` by removing the `@<ref>` suffix, so it is `<owner>/<repo>/<path>`.
   - **`environment`** is the ref gate. Without one, anyone who can push a branch could run the pinned workflow on it and mint a token. The gate is only as strong as the environment's rules: in **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern, add required reviewers if a release needs approval, and restrict who can create `v*` tags with a tag ruleset.
   - **`audience`** must be the exact string the CLI asks for: the target URL with its port and a trailing slash.
   - A workflow that deploys on a push to `main` can pin `workflow_ref` (`my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`) instead, which gates the ref by itself.

   For `https://token.actions.githubusercontent.com`, a policy must satisfy all three of these:

   | Requirement        | Satisfied by one of                                                      | Left open otherwise                             |
   | ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------- |
   | Pin the repository | `repository_id`, `repository`                                            | Any repository                                  |
   | Pin the workflow   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository                 |
   | Gate the ref       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed to the repository |

   `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.

   Store the target as a GitHub Actions variable, not a secret, since it isn't sensitive:

   ```bash
   gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
   ```

3. **Give Harper a durable credential for a private source**: Skip this for a public repository or package. Every node installs the release itself, and later installs (a new node joining, a reinstall after a restore) fetch the package again, so use a durable token, not the workflow's `GITHUB_TOKEN`, which expires when the job ends:
   - For a private repository: a **fine-grained** personal access token with **Contents: read-only**, scoped to the application repository.
   - For GitHub Packages: a token with the `read:packages` scope.

   Store it once, from your machine. `harper deploy setup=true` encrypts it locally with the cluster's public key, grants it to the component, and prints the `credentials` reference, which names the secret and never contains the token:

   ```bash
   harper deploy setup=true provider=github project=my-app
   harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org
   ```

   For `my-app`, the names are `deploy.my-app.git.github.com` for the repository and `deploy.my-app.npm.pkg.github.com` for GitHub Packages.

4. **Deploy a tagged release from the repository (Path A)**: Push a semver tag (`v1.2.3`), and every node clones and installs that commit:

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
         - uses: actions/setup-node@v4
           with:
             node-version: 22
         - run: npm install -g harper
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

   - **No secrets.** `vars.HARPER_CLI_TARGET` is the only thing the job is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the policy requires into it.
   - **`by_ref=true`** deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit even if the tag moves later. For a private repository, add `credential=true`, which attaches the `deploy.my-app.git.github.com` reference.
   - **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`.
   - **`restart=rolling`** restarts nodes one at a time. Use `restart=true` for a single-node or dev instance: there is no job, and the deploy step itself fails when a node rejects the release.
   - **`json=true`** puts the result on stdout and progress on stderr, so `deploy.json` holds only the result. A failed deploy exits non-zero.
   - **The wait step.** With `restart=rolling`, `harper deploy` exits `0` once the node you called has taken the release and started the rolling job. On v5.4.0 and later, the other nodes take the release in that job, one at a time, and a node that rejects it fails the job, not the deploy step; the failed job's `message` lists each node's outcome under `activated`. So the step polls `restartJobId` with `get_job` until it ends `COMPLETE` or `ERROR`.
   - **The job lives on one node.** Harper does not replicate jobs, so any node other than the one that received the deploy answers `get_job` with an empty list. Through a load-balanced cluster URL, at least one poll has to reach the node that received the deploy. If your load balancer sends the polls elsewhere, use one node's own URL for the deploy, the wait, and the policy's `audience`.
   - If the repository needs a build step to be runnable, don't reach for `install_allow_scripts`: use Path B.

5. **Build, publish and deploy an artifact (Path B)**: For an application that needs a build, CI builds, tests and publishes it to GitHub Packages, and Harper installs the published version. Give `package.json` a scoped name and `"publishConfig": { "registry": "https://npm.pkg.github.com" }`, and change Path A's job:
   - Add `packages: write` to `permissions`, and give `actions/setup-node@v4` `registry-url: https://npm.pkg.github.com` and `scope: '@my-org'`.
   - Run `npm ci`, `npm run build`, `npm test` and `npm publish`, with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` on `npm ci` and `npm publish`. Publishing happens inside the job, so the ephemeral `GITHUB_TOKEN` is right for it; installing on the nodes uses the durable `read:packages` token from step 3.
   - Deploy the published version, then keep Path A's wait step:

     ```bash
     harper deploy project=my-app package="@my-org/my-app@${GITHUB_REF_NAME#v}" \
       credentials='[{"registry":"https://npm.pkg.github.com","scope":"@my-org","secret":"deploy.my-app.npm.pkg.github.com"}]' \
       restart=rolling json=true > deploy.json
     ```

   - The deploy installs the version the tag names, and `npm publish` publishes the version in `package.json`, so they must agree: `npm version 1.2.3` sets one and creates the other as `v1.2.3`.

6. **Diagnose a refused run**: On success, the CLI prints to stderr which policy authenticated it, and as whom.
   - The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.
   - Remove `HARPER_CLI_REFRESH_TOKEN`, passwords, and credentials on the command. A configured credential outranks the exchange, so a pipeline that keeps one never uses OIDC.
   - If Harper rejects the token, the CLI reports it and carries on: with nothing else to try, the operation fails with a 401, but if anything else on the runner can authenticate, the command runs as that identity instead.
   - The server never says which check failed. Run `harper list_oidc_trust`, and check the policy for an `invalid_reason`, set when the policy is malformed or the user it names was deleted or deactivated. Then read the instance's `oidc-trust` log.

7. **Check the deployment record**: `deploy.json` also carries a `deployment_id`, which the `ci_deploy` role can read:

   ```bash
   harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
   ```

   Only the node you called writes that record, so with `restart=rolling` on v5.4.0 and later it can report `success` before the job has visited the other nodes, and keeps reporting it if one of them rejects the release. Wait on the job, not the record. `list_deployments` gives the history of what was deployed and when.

8. **Operate it**:
   - **Go back to a previous release** by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. To deploy a release that is no longer kept, re-run the deploy with its tag or version, which is why pinned references beat branch references in a pipeline.
   - **Rotate the deploy credential** by running `harper deploy setup=true` again with the same name and a new value. The pipeline doesn't change.
   - **Revoke the pipeline's access** with `drop_oidc_trust`, or deactivate the `ci-deploy` user with `alter_user`. Dropping the policy stops new exchanges, but an operation token already issued stays valid until its one-hour expiry, so in an incident also deactivate or re-role the user. There is no CI secret to rotate.
   - Git-host credentials need git 2.31 or later on the Harper nodes, and are not supported on Windows nodes. Fabric satisfies both.
   - On self-managed Harper core without the Pro secrets component, `secret` references can't be resolved, and a literal `token` is used for that node's install only.

## Examples

**One-time setup for a release workflow, as a super_user:**

```bash
harper login https://my-cluster.example.com:9925
harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment"]}'
harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
harper add_oidc_trust \
  id=my-app-release \
  issuer=https://token.actions.githubusercontent.com \
  audience=https://my-cluster.example.com:9925/ \
  user=ci-deploy \
  claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
harper list_oidc_trust
gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
```

**A policy for a workflow that deploys on a push to `main`, which pins `workflow_ref`:**

```bash
harper add_oidc_trust \
  id=my-app-main \
  issuer=https://token.actions.githubusercontent.com \
  audience=https://my-cluster.example.com:9925/ \
  user=ci-deploy \
  claims='{"repository_id":"67890","workflow_ref":"my-org/my-app/.github/workflows/deploy.yml@refs/heads/main","environment":"production"}'
```

**Revoking in an incident:**

```bash
harper drop_oidc_trust id=my-app-release
harper alter_user username=ci-deploy active=false
```
