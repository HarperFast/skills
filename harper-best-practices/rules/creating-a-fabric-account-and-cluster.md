---
name: creating-a-fabric-account-and-cluster
description: How to create a Harper Fabric account, organization, and cluster.
metadata:
  mode: synthesized
---

# Creating a Harper Fabric Account and Cluster

Follow these steps to set up your Harper Fabric environment for deployment.

## How It Works

1. **Sign Up/In**: Go to [https://fabric.harper.fast/](https://fabric.harper.fast/) and sign up or sign in.
2. **Create an Organization**: Create an organization (org) to manage your projects.
3. **Create a Cluster**: Create a new cluster. This can be on the free tier, no credit card required.
4. **Set Credentials**: During setup, set the cluster username and password to finish configuring it.
5. **Get Application URL**: Navigate to the **Config** tab and copy the **Application URL**.
6. **Connect the CLI**: Run `harper login` with the Application URL to store a token for the cluster, and set the URL as `HARPER_CLI_TARGET` in your `.env` file. Prefer this to putting the cluster username and password in `.env`, and don't store them in GitHub Actions secrets: to deploy from GitHub Actions, set up OIDC trusted publishing instead (see [deploying-from-ci](deploying-from-ci.md)).
7. **Next Steps**: See the [deploying-to-harper-fabric](deploying-to-harper-fabric.md) rule for detailed instructions on deploying your application successfully.

## Examples

### Environment Configuration

```bash
harper login YOUR_CLUSTER_URL
```

```bash
# .env
HARPER_CLI_TARGET='YOUR_CLUSTER_URL'
```
