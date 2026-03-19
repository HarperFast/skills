---
name: deploying-to-harper-fabric
description: How to deploy a Harper application to the Harper Fabric cloud.
---

# Deploying to Harper Fabric

Instructions for the agent to follow when deploying to Harper Fabric.

## When to Use

Use this skill when you are ready to move your Harper application from local development to a cloud-hosted environment.

## How It Works

1. **Sign up**: Follow the [creating-a-fabric-account-and-cluster](creating-a-fabric-account-and-cluster.md) rule to create a Harper Fabric account, organization, and cluster.
2. **Configure Environment**: Add your cluster credentials and cluster application URL to `.env`:
   ```bash
   CLI_TARGET_USERNAME='YOUR_CLUSTER_USERNAME'
   CLI_TARGET_PASSWORD='YOUR_CLUSTER_PASSWORD'
   CLI_TARGET='YOUR_CLUSTER_URL'
   ```
3. **Deploy From Local Environment**: Run `npm run deploy`.
4. **Set up CI/CD**: Configure `.github/workflows/deploy.yaml` and set repository secrets for automated deployments.

## Manual Setup for Existing Apps

If your application was not created with `npm create harper`, you'll need to manually configure the deployment scripts and CI/CD workflow.

### 1. Update `package.json`

Add the following scripts and dependencies to your `package.json`:

```json
{
	"scripts": {
		"deploy": "dotenv -- npm run deploy:component",
		"deploy:component": "harperdb deploy_component . restart=rolling replicated=true"
	},
	"devDependencies": {
		"dotenv-cli": "^11.0.0",
		"harperdb": "^4.7.20"
	}
}
```

#### Why split the scripts?

The `deploy` script is separated from `deploy:component` to ensure environment variables from your `.env` file are properly loaded and passed to the Harper CLI.

- `deploy`: Uses `dotenv-cli` to load environment variables (like `CLI_TARGET`, `CLI_TARGET_USERNAME`, and `CLI_TARGET_PASSWORD`) before executing the next command.
- `deploy:component`: The actual command that performs the deployment.

By using `dotenv -- npm run deploy:component`, the environment variables are correctly set in the shell session before `harperdb deploy_component` is called, allowing it to authenticate with your cluster.

### 2. Configure GitHub Actions

Create a `.github/workflows/deploy.yaml` file with the following content:

```yaml
name: Deploy to Harper Fabric
on:
  workflow_dispatch:
#  push:
#    branches:
#      - main
concurrency:
  group: main
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8 # v6.0.1
        with:
          fetch-depth: 0
          fetch-tags: true
      - name: Set up Node.js
        uses: actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f # v6.1.0
        with:
          cache: 'npm'
          node-version-file: '.nvmrc'
      - name: Install dependencies
        run: npm ci
      - name: Run unit tests
        run: npm test
      - name: Run lint
        run: npm run lint
      - name: Deploy
        run: npm run deploy
        env:
          CLI_TARGET: ${{ secrets.CLI_TARGET }}
          CLI_TARGET_USERNAME: ${{ secrets.CLI_TARGET_USERNAME }}
          CLI_TARGET_PASSWORD: ${{ secrets.CLI_TARGET_PASSWORD }}
```

Be sure to set the following repository secrets in your GitHub repository's /settings/secrets/actions:

- `CLI_TARGET`
- `CLI_TARGET_USERNAME`
- `CLI_TARGET_PASSWORD`
