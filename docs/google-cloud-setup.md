# GO development connection — gohub-509103

BIG authorized Google Cloud as temporary development power to upgrade existing systems. GitHub Actions uses Workload Identity Federation; existing OAuth Client/Refresh Token stays separate. Initial deliverable is a verified connection. Build/Compute execution requires a named job, its narrow permissions and an owner-selected spending limit; those are not yet configured.

## Cloud Shell setup

1. Review `scripts/cloud/bootstrap-gcp.sh` in this PR. It enables four identity APIs, creates a dedicated pool/provider/service account/custom role, and adds two IAM bindings. It does not create keys, VMs, buckets or builds. The service account is granted only `resourcemanager.projects.get`.
2. Open Google Cloud Console, select `gohub-509103`, then open Cloud Shell. Download the reviewed script at an immutable commit (replace `REVIEWED_COMMIT` with the PR commit SHA):

   ```bash
   curl --fail --show-error --location 'https://raw.githubusercontent.com/pureekangraw-ops/Greenhouse/REVIEWED_COMMIT/scripts/cloud/bootstrap-gcp.sh' --output go-cloud-setup.sh
   bash go-cloud-setup.sh
   bash go-cloud-setup.sh --apply
   ```

   The first run is a read-only project lookup. `--apply` changes IAM configuration. The owner needs project API enablement, Workload Identity Pool Admin, Service Account Admin, Role Admin and project IAM policy modification permissions. Existing owner rights normally cover these; organization policies can restrict them. Do not grant these administrator roles to GitHub.
3. The script reads the Project Number from Google Cloud rather than inferring it from the OAuth Client ID. Copy the two non-secret output values into Greenhouse → Settings → Secrets and variables → Actions → Variables:
   - `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `GCP_SERVICE_ACCOUNT`
4. Review/merge the PR before running Actions → **GCP connection check** → Run workflow → branch `main`. The trust condition admits only numeric owner ID `312069576`, repository ID `1407104964`, manual dispatch on `main`, and this exact workflow path. Other repositories, branches and triggers are rejected.
5. A successful project-read step is the authentication acceptance evidence. A configured provider or passing local syntax checks alone is not acceptance. IAM propagation can take several minutes. Return the run URL and bootstrap output if it fails; never send credentials/tokens.

## Re-run and recovery

Re-running `--apply` reuses matching resources and additive bindings. A conflicting provider/custom role or disabled object stops the script instead of rewriting it. A failure can leave already-created resources in place; inspect the error and those resources before retrying. A pre-existing service account may have other grants; this script does not audit or remove its other inherited permissions.

## Cost and control boundaries

This initial workflow only authenticates and reads project metadata. It does not establish paid processing, runtime dependence, or automatic deployment. Ordinary alerts-only budgets do not enforce a spending ceiling. Service-specific spend caps have eligibility and enforcement limitations; verify the intended compute service before describing any setting as a hard cap. Billing/credits, quotas and a monetary limit remain unverified.

Cloudflare is not required for this first GitHub-to-Cloud connection. No Metro is used. GO's ability to dispatch workflows through a connector remains unverified; the owner can run the manual workflow in GitHub once it is on `main`.

References: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines ; https://github.com/google-github-actions/auth ; https://github.com/google-github-actions/auth/blob/main/docs/SECURITY_CONSIDERATIONS.md ; https://docs.cloud.google.com/billing/docs/how-to/budgets
