---
name: creating-harper-apps
description: How to initialize a new Harper application using the CLI.
metadata:
  mode: synthesized
---

# Creating Harper Applications

The fastest way to start a new Harper project is using the `create-harper` CLI tool. This command
initializes a project with a standard folder structure, essential configuration files, and basic
schema definitions.

## When to Use

Use this command when starting a new Harper application or adding a new Harper microservice to an
existing architecture.

## Commands

Initialize a project using your preferred package manager:

### NPM

```bash
npm create harper@latest
```

### PNPM

```bash
pnpm create harper@latest
```

### Bun

```bash
bun create harper@latest
```

## Options

You can specify the project name and template directly:

```bash
npm create harper@latest my-app --template default
```

## Next Steps

1. **Define Schema**: Modify `schema.graphql` to fit your application's data model.
2. **Start Development**: Run `npm run dev` to start the local Harper instance.
3. **Connect the CLI to your cluster**: Create a cluster (see
   [creating-a-fabric-account-and-cluster](creating-a-fabric-account-and-cluster.md)), run `harper login` with its
   Application URL as a super user, and set that URL as `HARPER_CLI_TARGET` in the project's `.env` file. Don't put a
   cluster username or password in `.env` or in GitHub secrets.
4. **Deploy**: See [Deploying](#deploying).

## Deploying

Every template except the legacy `early-hints` example ships a GitHub Actions workflow,
`.github/workflows/deploy.yaml`. It tests every pull request and deploys to the cluster when a change merges to `main`.
The deploy job holds no Harper credential: its `harper` commands authenticate with GitHub's OIDC identity token under a
trust policy on the cluster. The Next.js templates' workflow also runs `next build` before it uploads.

1. **Set up CI deploys once**: Push the project to a GitHub repository, then run `npm run deploy:setup-ci` from the
   project, logged in to the cluster as a super user. It runs `harper deploy setup=true provider=github-actions` for the
   project, which creates a deploy-only role and user and a trust policy matched to the workflow, and sets the
   repository's `HARPER_CLI_TARGET` variable when the `gh` CLI is signed in (otherwise it prints the command to run).
   Running it again changes nothing. See [deploying-from-ci](deploying-from-ci.md) for what it checks and how to
   customize it.

   The command needs the Harper 5.4.0 CLI or later (`harper version`); an earlier CLI can't run it. Without 5.4.0, set
   up the same role, user, policy and variable by hand, as a super user. The policy must match the scaffolded workflow:
   its `deploy.yaml` file on `main`, in the `production` environment. The `audience` is the cluster URL with its port
   and a trailing slash, and `HARPER_CLI_TARGET` must be that same string:

   ```bash
   gh api repos/<owner>/<repo> --jq .id   # the repository_id
   harper add_role role=<name>-ci-deploy permission='{"operations":["deploy_component","get_job","registration_info"]}'
   harper add_user username=<name>-ci-deploy role=<name>-ci-deploy active=true password="$(openssl rand -base64 32)"
   harper add_oidc_trust \
     id=github-actions-<name> \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=<name>-ci-deploy \
     claims='{"repository_id":"<id>","workflow_ref":"<owner>/<repo>/.github/workflows/deploy.yaml@refs/heads/main","environment":"production"}'
   gh variable set HARPER_CLI_TARGET --repo <owner>/<repo> --body https://my-cluster.example.com:9925/
   ```

   If you restrict the `production` environment's deployment branches, allow `main`.

2. **Deploy by merging to `main`**, or by running the workflow from the **Actions** tab. The workflow deploys with
   `restart=rolling` and waits for every node to take the release. The run's summary names the `deployment_id` and its
   `certification`.
3. **Deploy by hand with `npm run deploy`**: It runs `harper deploy project=<name> restart=rolling` from your machine, as
   the user you logged in with.
4. **Go back to an earlier release** by activating its `deployment_id`, with nothing reinstalled:

   ```bash
   harper list_deployments project=<name>
   harper deploy project=<name> deployment_id=<id> restart=rolling
   ```

   See [deploying-to-harper-fabric](deploying-to-harper-fabric.md).

Use your package manager's equivalent of `npm run` (`pnpm run`, `bun run`, `yarn`) if the project uses another one.

Projects created before create-harper 1.13.0 deploy on version tags with a `HARPER_CLI_REFRESH_TOKEN` secret, and
don't have `deploy:setup-ci`. To move one over:

1. Scaffold a new project with the same name and template, and copy its `.github/workflows/deploy.yaml` over the old
   workflow.
2. Set up the cluster for it, with the `project=` value that workflow passes to `harper deploy` as `<name>`: with the
   5.4.0 CLI, `harper deploy setup=true provider=github-actions project=<name>`; with an earlier one, by hand as in
   step 1.
3. Push the new workflow to `main`.
4. Once the workflow's run on `main` has succeeded, wait step included, delete the `HARPER_CLI_REFRESH_TOKEN` secret.
   Deleting it doesn't revoke the token, which stays valid until it expires. To cut it off now, mint a new one for that
   user with `harper login --for-ci`, which invalidates the old one, or deactivate the user with `alter_user` if
   nothing else uses it.
