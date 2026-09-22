/*
 * Count active incidents per assignment group.
 *
 * Use GlideAggregate, not GlideRecord. GlideAggregate pushes the COUNT and the
 * GROUP BY down into a single SQL statement, so the database returns one row per
 * assignment group instead of one row per incident. No record objects are
 * hydrated on the application node and no JavaScript loop walks the result set.
 */

function getActiveIncidentCountsByGroup() {
    var counts = {};

    var ga = new GlideAggregate('incident');
    ga.addQuery('active', true);
    ga.addAggregate('COUNT', 'assignment_group');  // implies GROUP BY assignment_group
    ga.orderByAggregate('COUNT', 'assignment_group');
    ga.query();

    while (ga.next()) {
        // One iteration per assignment group, not per incident.
        counts[ga.getValue('assignment_group')] = {
            name: ga.getDisplayValue('assignment_group'),
            count: parseInt(ga.getAggregate('COUNT', 'assignment_group'), 10)
        };
    }

    return counts;
}

/*
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
 *     ga.addHaving('COUNT', 'assignment_group', '>', 10);
 *
 * Extra dimension (group x priority) -- add a second groupBy, still one query:
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
 * - addAggregate('COUNT', field) already groups by that field; calling
 *   groupBy() on the same field as well is redundant.
 * - getAggregate() returns a string -- parseInt it before doing arithmetic.
 * - Server-side GlideAggregate does not apply read ACLs (there is no
 *   GlideAggregateSecure), so add the caller's restrictions to the query
 *   yourself if the numbers are user-facing.
 * - For dashboards, prefer an indicator/scorecard or a database view over an
 *   on-demand script that recomputes on every page load.
 */
