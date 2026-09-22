/*
 * Count active incidents per assignment group.
 *
 * Use GlideAggregate, not GlideRecord. GlideAggregate pushes the COUNT and the
 * GROUP BY down into a single SQL statement, so the database returns one row per
 * assignment group instead of one row per incident. No record objects are
 * hydrated on the application node, and the loop below runs once per group --
 * tens of iterations -- rather than once per incident.
 *
 * Paste the whole file into a background script to run it as-is.
 */

// ---------------------------------------------------------------------------
// 1. The script
// ---------------------------------------------------------------------------

/**
 * Active incident counts, keyed by assignment group sys_id.
 *
 * @return {Object} sys_id -> { name: String, count: Number }, plus the key
 *                  '' for incidents with no assignment group.
 */
function getActiveIncidentCountsByGroup() {
    var counts = {};

    var ga = new GlideAggregate('incident');
    ga.addQuery('active', true);
    ga.addAggregate('COUNT');              // COUNT(*)
    ga.groupBy('assignment_group');        // ... GROUP BY assignment_group
    ga.orderByAggregate('COUNT');          // busiest group first, sorted in the DB
    ga.query();

    while (ga.next()) {
        var groupId = ga.getValue('assignment_group') || '';

        counts[groupId] = {
            name: ga.getDisplayValue('assignment_group') || '(unassigned)',
            // getAggregate() returns a String -- parse it before any arithmetic
            // or comparison, or "9" > "10" will bite you.
            count: parseInt(ga.getAggregate('COUNT'), 10)
        };
    }

    return counts;
}

// ---------------------------------------------------------------------------
// 2. Running it
// ---------------------------------------------------------------------------

(function main() {
    var counts = getActiveIncidentCountsByGroup();
    var total = 0;
    var lines = [];

    // Build the output first, then log once. Calling gs.info() inside the
    // aggregate loop is its own performance problem in anything production-facing.
    for (var groupId in counts) {
        if (!counts.hasOwnProperty(groupId)) continue;
        lines.push(counts[groupId].name + ': ' + counts[groupId].count);
        total += counts[groupId].count;
    }

    gs.info('Active incidents by assignment group ({0} groups, {1} incidents)\n{2}',
        lines.length, total, lines.join('\n'));
})();

/*
 * Two equivalent forms -- pick one and keep the getter consistent
 * --------------------------------------------------------------
 * A) COUNT(*) with an explicit groupBy (used above, and the more common idiom):
 *        ga.addAggregate('COUNT');
 *        ga.groupBy('assignment_group');
 *        ...
 *        ga.getAggregate('COUNT');                        // no field argument
 *
 * B) COUNT(field), which groups by that field implicitly:
 *        ga.addAggregate('COUNT', 'assignment_group');    // no groupBy needed
 *        ...
 *        ga.getAggregate('COUNT', 'assignment_group');    // field argument required
 *
 * The classic bug is crossing them -- setting with a field and reading without
 * it (or the reverse) returns empty, not an error. Match the getter to the setter.
 *
 * In SQL, COUNT(column) skips NULLs while COUNT(*) does not. The two agree here
 * because ServiceNow stores an empty reference field as an empty string rather
 * than NULL, so unassigned incidents land in the '' group either way -- but form
 * (A) has no such ambiguity, which is why it is the safer default.
 *
 * Variants
 * --------
 * Single total, no grouping:
 *     var ga = new GlideAggregate('incident');
 *     ga.addQuery('active', true);
 *     ga.addAggregate('COUNT');
 *     ga.query();
 *     var total = ga.next() ? parseInt(ga.getAggregate('COUNT'), 10) : 0;
 *
 * One group only -- still no loop:
 *     var gr = new GlideRecord('incident');
 *     gr.addQuery('active', true);
 *     gr.addQuery('assignment_group', groupSysId);
 *     gr.setCategory('count_only');
 *     gr.query();
 *     var n = gr.getRowCount();   // SELECT COUNT(*), no rows fetched
 *
 * Only groups above a threshold (HAVING, evaluated in the database):
 *     ga.addHaving('COUNT', '>', 10);
 *
 * Extra dimension (group x priority) -- add a second groupBy, still one query:
 *     ga.groupBy('assignment_group');
 *     ga.groupBy('priority');
 *
 * Anti-pattern -- do NOT do this:
 *     var gr = new GlideRecord('incident');
 *     gr.addQuery('active', true);
 *     gr.query();
 *     while (gr.next()) { counts[gr.assignment_group] = (counts[gr.assignment_group] || 0) + 1; }
 *   Streams every active incident to the app node, builds a GlideRecord object
 *   per row, and burns transaction time and heap that scale with table size.
 *
 * Supporting notes
 * ----------------
 * - Index the filter/group columns: incident(active, assignment_group).
 *   Aggregation is only cheap if the database can satisfy it from an index.
 * - getAggregate() returns a string -- parseInt it before doing arithmetic.
 * - Server-side GlideAggregate does not apply read ACLs (there is no
 *   GlideAggregateSecure), so add the caller's restrictions to the query
 *   yourself if the numbers are user-facing.
 * - For dashboards, prefer an indicator/scorecard or a database view over an
 *   on-demand script that recomputes on every page load.
 */
