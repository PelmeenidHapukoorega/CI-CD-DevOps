#!/bin/sh
set -eu

APP_NAME="hermitden-site"
NAMESPACE_ARGOCD="argocd"
NAMESPACE_SITE="default"

RAW=$(kubectl get application "$APP_NAME" -n "$NAMESPACE_ARGOCD" -o json)

SYNC_STATUS=$(echo "$RAW" | jq -r '.status.sync.status')
HEALTH_STATUS=$(echo "$RAW" | jq -r '.status.health.status')
LAST_DEPLOYED=$(echo "$RAW" | jq -r '.status.operationState.finishedAt // "unknown"')
DEPLOY_COUNT=$(echo "$RAW" | jq -r '.status.history | length')

OUTPUT=$(jq -n \
  --arg sync "$SYNC_STATUS" \
  --arg health "$HEALTH_STATUS" \
  --arg last "$LAST_DEPLOYED" \
  --arg count "$DEPLOY_COUNT" \
  --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{sync_status: $sync, health_status: $health, last_deployed: $last, deploy_count: ($count | tonumber), data_generated_at: $updated}')

kubectl create configmap deploy-history -n "$NAMESPACE_SITE" \
  --from-literal=data.json="$OUTPUT" \
  --dry-run=client -o yaml | kubectl apply -f -
# rebuild trigger
