# Counting incidents without looping through them

**Scenario:** "I need the number of active incidents for each assignment group.
How would you write it efficiently?"

## Short answer

Use `GlideAggregate`, not `GlideRecord`. Let the database do the `COUNT` and the
`GROUP BY`; return one row per assignment group instead of one row per incident.

```javascript
var counts = {};

var ga = new GlideAggregate('incident');
ga.addQuery('active', true);
ga.addAggregate('COUNT', 'assignment_group');  // implies GROUP BY assignment_group
ga.query();

while (ga.next()) {
    counts[ga.getValue('assignment_group')] = parseInt(
        ga.getAggregate('COUNT', 'assignment_group'), 10);
}
```

The loop still exists syntactically, but it runs once per assignment group —
tens of iterations — not once per incident. Full script with variants and notes:
[`count-active-incidents-by-group.js`](count-active-incidents-by-group.js).

## Why the obvious version is wrong

```javascript
// Anti-pattern
var gr = new GlideRecord('incident');
gr.addQuery('active', true);
gr.query();
while (gr.next()) {
    var g = gr.getValue('assignment_group');
    counts[g] = (counts[g] || 0) + 1;
}
```

This asks the database for every active incident, ships every row to the
application node, and instantiates a `GlideRecord` object per row — all to throw
away every field except one. Cost scales with the size of the table, so it
passes in a dev instance with 500 incidents and times out in production with
500,000. `GlideAggregate` does the same work in one SQL statement whose result
set is bounded by the number of groups.

| | rows returned to the app node | objects built | scales with |
| --- | --- | --- | --- |
| `GlideRecord` + manual count | one per incident | one per incident | table size |
| `GlideAggregate` | one per group | one per group | number of groups |

## Related cases

- **One total, no grouping** — `addAggregate('COUNT')` with no field, read it off
  the single result row.
- **Count for one group only** — `GlideRecord` with `setCategory('count_only')`
  plus `getRowCount()`; issues a `SELECT COUNT(*)` and fetches no rows. (Calling
  `getRowCount()` on an ordinary query is fine too, but avoid it as a preamble to
  a loop you then run anyway.)
- **Only groups over a threshold** — `addHaving('COUNT', 'assignment_group', '>', 10)`,
  so the filtering happens in the database rather than in a post-loop.
- **Two dimensions** (group × priority) — add `ga.groupBy('priority')`; still one query.
- **From outside the instance** — the Aggregate API, `/api/now/stats/incident`
  with `sysparm_count=true&sysparm_group_by=assignment_group`. It is the REST
  front door to `GlideAggregate`. Working script:
  [`count-active-incidents.sh`](count-active-incidents.sh). Counting by paging
  `/api/now/table/incident` and measuring the array length has the same defect as
  the anti-pattern above, with network transfer added.

## Things worth saying out loud in the interview

- Index the columns you filter and group on: `incident(active, assignment_group)`.
  Aggregation is only cheap if the database can satisfy it from an index.
- `addAggregate('COUNT', field)` already groups by that field — a separate
  `groupBy()` on the same field is redundant.
- `getAggregate()` returns a **string**; `parseInt` it before arithmetic or
  comparison.
- Server-side `GlideAggregate` does not apply read ACLs (there is no
  `GlideAggregateSecure`), so add the caller's restrictions to the query yourself
  if the numbers are user-facing.
- For a dashboard, don't recompute on every page load — use an
  indicator/scorecard, a database view, or a cached scheduled job. The fastest
  query is the one you don't run.
