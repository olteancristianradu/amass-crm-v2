#!/usr/bin/env bash
# Configure branch protection on `main` for the AMASS CRM repo.
#
# Settings applied:
#   - Require status checks (CI, CodeQL Security Analysis, Secret Scan)
#   - Require strict status checks (branch must be up to date before merge)
#   - Block force pushes
#   - Require linear history
#   - Do NOT require PR reviews (solo dev would lock self out)
#   - Apply to administrators (no carve-outs)
#
# Usage:
#   bash scripts/setup-branch-protection.sh
#
# Requires:
#   - gh CLI authenticated with repo + admin:repo permissions
#   - Run from inside the repo

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install: brew install gh" >&2
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Configuring branch protection on ${REPO}@main..."

# REST API call. The gh api command lets us PUT the protection rules.
# Reference: https://docs.github.com/en/rest/branches/branch-protection
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/${REPO}/branches/main/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "lint-typecheck-build",
      "CodeQL Security Analysis",
      "gitleaks (full history)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF

echo "Done. Verify in: https://github.com/${REPO}/settings/branches"
