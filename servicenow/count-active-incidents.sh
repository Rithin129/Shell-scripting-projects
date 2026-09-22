#!/bin/bash
#
# Count active incidents per assignment group from outside the instance,
# without downloading a single incident record.
#
# Uses the Aggregate API (/api/now/stats/<table>), which is the REST front door
# to GlideAggregate: the COUNT and the GROUP BY run in the database and the
# response is one row per group.
#
# Usage:
#   export SN_INSTANCE=dev12345          # instance name, not the full URL
#   export SN_USER=admin
#   export SN_PASSWORD=...               # or use an OAuth token instead
#   ./count-active-incidents.sh
#
set -euo pipefail

: "${SN_INSTANCE:?set SN_INSTANCE to your instance name, e.g. dev12345}"
: "${SN_USER:?set SN_USER}"
: "${SN_PASSWORD:?set SN_PASSWORD}"

BASE_URL="https://${SN_INSTANCE}.service-now.com"

# sysparm_count=true        -> COUNT(*)
# sysparm_group_by=...      -> GROUP BY, one result row per assignment group
# sysparm_query=active=true -> WHERE active = 1
# sysparm_display_value     -> return the group's name alongside its sys_id
response=$(curl -sS --fail-with-body \
    --get "${BASE_URL}/api/now/stats/incident" \
    --user "${SN_USER}:${SN_PASSWORD}" \
    --header 'Accept: application/json' \
    --data-urlencode 'sysparm_count=true' \
    --data-urlencode 'sysparm_query=active=true' \
    --data-urlencode 'sysparm_group_by=assignment_group' \
    --data-urlencode 'sysparm_display_value=true')

# Response shape:
#   {"result":[{"stats":{"count":"42"},"groupby_fields":[{"field":"assignment_group","value":"Network"}]}, ...]}
echo "$response" | jq -r '
    ["ASSIGNMENT_GROUP","ACTIVE_INCIDENTS"],
    ( .result[]
      | [ ( (.groupby_fields[] | select(.field=="assignment_group") | .value)
            | if . == null or . == "" then "(unassigned)" else . end ),
          .stats.count ] )
    | @tsv'

# Just the overall total, still one database COUNT and no records fetched:
#   curl -sS --get "${BASE_URL}/api/now/stats/incident" \
#       --user "${SN_USER}:${SN_PASSWORD}" \
#       --data-urlencode 'sysparm_count=true' \
#       --data-urlencode 'sysparm_query=active=true' | jq -r '.result.stats.count'
#
# Do NOT do this instead -- it pages every active incident back over the wire
# just to count them:
#   curl ".../api/now/table/incident?sysparm_query=active=true&sysparm_limit=10000" | jq '.result | length'
