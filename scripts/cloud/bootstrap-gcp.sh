#!/usr/bin/env bash
# Run in Google Cloud Shell as the project owner. No OAuth secrets required.
set -euo pipefail
# IAM resources can take up to five minutes to become visible after creation.
# Retry only NOT_FOUND; permission/configuration errors fail immediately.
gcloud_wait_visible() {
  local task_attempt task_output task_status task_error
  task_error=$(mktemp)
  for ((task_attempt=1; task_attempt<=21; task_attempt++)); do
    if task_output=$(gcloud "$@" 2>"$task_error"); then
      cat "$task_error" >&2
      rm -f "$task_error"
      printf '%s\n' "$task_output"
      return 0
    else
      task_status=$?
    fi
    if ! grep -Fq 'NOT_FOUND' "$task_error" || ((task_attempt == 21)); then
      cat "$task_error" >&2
      rm -f "$task_error"
      return "$task_status"
    fi
    printf 'IAM resource not visible yet; retry %s/20 in 15 seconds.\n' "$task_attempt" >&2
    sleep 15
  done
}
TASK_PROJECT='gohub-509103'
TASK_POOL='go-github-dev'
TASK_PROVIDER='greenhouse'
TASK_SA='go-github-check'
TASK_ROLE='goProjectIdentityRead'
TASK_EMAIL="${TASK_SA}@${TASK_PROJECT}.iam.gserviceaccount.com"
TASK_MAPPING='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id'
TASK_CONDITION="assertion.repository_owner_id == '312069576' && assertion.repository_id == '1407104964' && assertion.ref == 'refs/heads/main' && assertion.event_name == 'workflow_dispatch' && assertion.workflow_ref == 'pureekangraw-ops/Greenhouse/.github/workflows/gcp-connection-check.yml@refs/heads/main'"
command -v gcloud >/dev/null
command -v jq >/dev/null
TASK_NUMBER=$(gcloud projects describe "$TASK_PROJECT" --format='value(projectNumber)')
[[ "$TASK_NUMBER" =~ ^[0-9]+$ ]] || { echo 'Project number lookup failed.' >&2; exit 1; }
printf 'Project verified: %s (%s)\n' "$TASK_PROJECT" "$TASK_NUMBER"
if [[ "${1:-}" != '--apply' ]]; then
  echo 'Read-only preflight complete. Use --apply to enable identity APIs and create scoped GitHub access.'
  exit 0
fi
gcloud services enable iam.googleapis.com cloudresourcemanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com --project="$TASK_PROJECT"
# Successful list calls distinguish absent resources from permission/network errors.
TASK_POOLS=$(gcloud iam workload-identity-pools list --location=global --project="$TASK_PROJECT" --format=json)
if ! jq -e --arg suffix "/${TASK_POOL}" 'any(.[]; .name | endswith($suffix))' <<<"$TASK_POOLS" >/dev/null; then
  gcloud iam workload-identity-pools create "$TASK_POOL" --project="$TASK_PROJECT" \
    --location=global --display-name='GO GitHub development'
fi
TASK_POOL_JSON=$(gcloud_wait_visible iam workload-identity-pools describe "$TASK_POOL" --project="$TASK_PROJECT" --location=global --format=json)
jq -e '.state == "ACTIVE" and (.disabled != true)' <<<"$TASK_POOL_JSON" >/dev/null
TASK_PROVIDERS=$(gcloud_wait_visible iam workload-identity-pools providers list --project="$TASK_PROJECT" --location=global --workload-identity-pool="$TASK_POOL" --format=json)
if ! jq -e --arg suffix "/${TASK_PROVIDER}" 'any(.[]; .name | endswith($suffix))' <<<"$TASK_PROVIDERS" >/dev/null; then
  gcloud iam workload-identity-pools providers create-oidc "$TASK_PROVIDER" \
    --project="$TASK_PROJECT" --location=global --workload-identity-pool="$TASK_POOL" \
    --issuer-uri='https://token.actions.githubusercontent.com' \
    --attribute-mapping="$TASK_MAPPING" --attribute-condition="$TASK_CONDITION"
fi
TASK_PROVIDER_JSON=$(gcloud_wait_visible iam workload-identity-pools providers describe "$TASK_PROVIDER" --project="$TASK_PROJECT" --location=global --workload-identity-pool="$TASK_POOL" --format=json)
# Fail rather than overwrite an existing provider with different trust rules.
jq -e --arg cond "$TASK_CONDITION" '.state == "ACTIVE" and (.disabled != true) and .oidc.issuerUri == "https://token.actions.githubusercontent.com" and ((.oidc.allowedAudiences // []) | length == 0) and .attributeCondition == $cond and .attributeMapping == {"google.subject":"assertion.sub","attribute.repository_id":"assertion.repository_id","attribute.repository_owner_id":"assertion.repository_owner_id"}' <<<"$TASK_PROVIDER_JSON" >/dev/null
TASK_ACCOUNTS=$(gcloud iam service-accounts list --project="$TASK_PROJECT" --format=json)
if ! jq -e --arg email "$TASK_EMAIL" 'any(.[]; .email == $email)' <<<"$TASK_ACCOUNTS" >/dev/null; then
  gcloud iam service-accounts create "$TASK_SA" --project="$TASK_PROJECT" --display-name='GO GitHub connection check'
fi
gcloud_wait_visible iam service-accounts describe "$TASK_EMAIL" --project="$TASK_PROJECT" --format=json | jq -e '.disabled != true' >/dev/null
TASK_ROLES=$(gcloud iam roles list --project="$TASK_PROJECT" --format=json)
if ! jq -e --arg suffix "/${TASK_ROLE}" 'any(.[]; .name | endswith($suffix))' <<<"$TASK_ROLES" >/dev/null; then
  gcloud iam roles create "$TASK_ROLE" --project="$TASK_PROJECT" \
    --title='GO project identity read' --permissions='resourcemanager.projects.get' --stage=GA
fi
gcloud_wait_visible iam roles describe "$TASK_ROLE" --project="$TASK_PROJECT" --format=json | jq -e '.includedPermissions == ["resourcemanager.projects.get"] and .stage == "GA" and (.deleted != true)' >/dev/null
TASK_MEMBER="principalSet://iam.googleapis.com/projects/${TASK_NUMBER}/locations/global/workloadIdentityPools/${TASK_POOL}/attribute.repository_id/1407104964"
gcloud_wait_visible iam service-accounts add-iam-policy-binding "$TASK_EMAIL" --project="$TASK_PROJECT" \
  --role='roles/iam.workloadIdentityUser' --member="$TASK_MEMBER" --condition=None >/dev/null
gcloud_wait_visible projects add-iam-policy-binding "$TASK_PROJECT" \
  --member="serviceAccount:${TASK_EMAIL}" --role="projects/${TASK_PROJECT}/roles/${TASK_ROLE}" --condition=None >/dev/null
# Independent configuration readback. This is NOT a GitHub authentication test.
gcloud_wait_visible iam service-accounts get-iam-policy "$TASK_EMAIL" --project="$TASK_PROJECT" --format=json | jq -e --arg member "$TASK_MEMBER" 'any(.bindings[]; .role == "roles/iam.workloadIdentityUser" and (.members | index($member)) != null and (has("condition") | not))' >/dev/null
gcloud_wait_visible projects get-iam-policy "$TASK_PROJECT" --format=json | jq -e --arg member "serviceAccount:${TASK_EMAIL}" --arg role "projects/${TASK_PROJECT}/roles/${TASK_ROLE}" 'any(.bindings[]; .role == $role and (.members | index($member)) != null and (has("condition") | not))' >/dev/null
echo 'Configuration readback passed. Set these GitHub Actions repository variables:'
printf 'GCP_WORKLOAD_IDENTITY_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\n' "$TASK_NUMBER" "$TASK_POOL" "$TASK_PROVIDER"
printf 'GCP_SERVICE_ACCOUNT=%s\n' "$TASK_EMAIL"
echo 'Next: run GCP connection check on main after the PR is merged. IAM propagation may take several minutes.'
