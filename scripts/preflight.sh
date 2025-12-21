#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Preflight checks for AFU-9 deploy

Required args:
  --cluster NAME                 ECS cluster name (default: afu9-cluster)
  --service NAME                 Primary ECS service name (default: afu9-control-center)
  --domain NAME                  Base domain (e.g., afu-9.com)
  --cdk-args "ARGS"              Arguments for cdk diff (e.g., "-c afu9-multi-env=false ... Afu9EcsStack Afu9RoutingSingleEnvStack")

Optional args:
  --staging-service NAME         Staging service name (default: afu9-control-center-staging)
  --require-staging true|false   Fail if staging service missing (default: true)
  --manage-dns true|false        Whether CDK will manage DNS (default: false)
  --create-staging-service true|false  Whether CDK intends to create staging service (default: true)

Exit codes:
  0  success
  2  usage error
  3  missing prerequisites (aws/jq/npx)
  4  cluster/service missing
 10  diff gate violation
USAGE
}

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 3; }; }

cluster="afu9-cluster"
service="afu9-control-center"
staging_service="afu9-control-center-staging"
require_staging="true"
manage_dns="false"
create_staging="true"
domain=""
cdk_args=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster) cluster="$2"; shift 2;;
    --service) service="$2"; shift 2;;
    --staging-service) staging_service="$2"; shift 2;;
    --require-staging) require_staging="$2"; shift 2;;
    --manage-dns) manage_dns="$2"; shift 2;;
    --create-staging-service) create_staging="$2"; shift 2;;
    --domain) domain="$2"; shift 2;;
    --cdk-args) cdk_args="$2"; shift 2;;
    --help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2;;
  esac
done

if [[ -z "$domain" ]] || [[ -z "$cdk_args" ]]; then
  echo "Missing required --domain or --cdk-args" >&2
  usage
  exit 2
fi

need_cmd aws
need_cmd jq
need_cmd npx

info() { echo "[info] $*"; }
fail() { echo "[fail] $*" >&2; exit "$2"; }

# Cluster check
info "Checking ECS cluster: $cluster"
cluster_json=$(aws ecs describe-clusters --clusters "$cluster" --query 'clusters[0].{status:status,arn:clusterArn}' --output json)
cluster_status=$(echo "$cluster_json" | jq -r '.status // ""')
if [[ -z "$cluster_status" || "$cluster_status" == "null" ]]; then
  fail "Cluster not found: $cluster" 4
fi
info "Cluster status: $cluster_status"
if [[ "$cluster_status" != "ACTIVE" ]]; then
  fail "Cluster is not ACTIVE: $cluster_status" 4
fi

# Service check
check_service() {
  local svc="$1"
  local required="$2"
  info "Checking ECS service: $svc"
  svc_json=$(aws ecs describe-services --cluster "$cluster" --services "$svc" --output json)
  failures=$(echo "$svc_json" | jq -r '.failures | length')
  count=$(echo "$svc_json" | jq -r '.services | length')
  if [[ "$failures" != "0" || "$count" == "0" ]]; then
    if [[ "$required" == "true" ]]; then
      fail "Required service missing: $svc in cluster $cluster" 4
    else
      info "Service missing (allowed): $svc"
      return
    fi
  fi

  svc_status=$(echo "$svc_json" | jq -r '.services[0].status // ""')
  info "Service present: $svc (status=$svc_status)"
  if [[ -z "$svc_status" || "$svc_status" == "null" ]]; then
    fail "Could not determine service status for $svc" 4
  fi
  if [[ "$svc_status" != "ACTIVE" ]]; then
    fail "Service is not ACTIVE ($svc_status): $svc. Recreate it via CDK/infra deploy before running deploy-ecs." 4
  fi
}

check_service "$service" true
if [[ "$create_staging" == "true" ]]; then
  check_service "$staging_service" "$require_staging"
else
  info "Staging service creation disabled; skipping staging existence check"
fi

# DNS check
if [[ -n "$domain" ]]; then
  info "Checking Route53 records for domain $domain"
  hz_json=$(aws route53 list-hosted-zones-by-name --dns-name "$domain" --max-items 1 --output json)
  hz_name=$(echo "$hz_json" | jq -r '.HostedZones[0].Name // ""')
  hz_id=$(echo "$hz_json" | jq -r '.HostedZones[0].Id // ""' | sed 's#^.*/##')
  if [[ "$hz_name" != "$domain." ]]; then
    info "Hosted zone for $domain not found; skipping DNS record checks"
  else
    names=("$domain" "www.$domain" "stage.$domain" "prod.$domain")
    for name in "${names[@]}"; do
      count=$(aws route53 list-resource-record-sets --hosted-zone-id "$hz_id" --query "ResourceRecordSets[?Name=='$name.'] | length(@)" --output text)
      if [[ "$count" != "0" ]]; then
        info "Existing DNS record: $name (count=$count)"
        if [[ "$manage_dns" == "true" ]]; then
          fail "manageDns=true but existing record $name detected. Rerun with --manage-dns false." 4
        fi
      fi
    done
  fi
fi

# Diff gate
info "Running cdk diff gate"
read -r -a cdk_args_arr <<< "$cdk_args"
diff_output=$(npx cdk diff "${cdk_args_arr[@]}" 2>&1 || true)
echo "$diff_output" > /tmp/preflight-cdk-diff.log

protected="AWS::(ECS::Cluster|IAM::Role|ElasticLoadBalancingV2::Listener)"
if [[ "$manage_dns" == "false" ]]; then
  protected="AWS::(ECS::Cluster|IAM::Role|ElasticLoadBalancingV2::Listener|Route53::RecordSet)"
fi

if echo "$diff_output" | grep -E "\[\-\].*($protected)" >/dev/null; then
  fail "Diff gate: deletions detected for protected resources" 10
fi
if echo "$diff_output" | grep -E "replace.*($protected)" >/dev/null; then
  fail "Diff gate: replacements detected for protected resources" 10
fi

info "Preflight checks passed"
