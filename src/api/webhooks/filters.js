'use strict';

/** Supported per-condition operators. Unknown operators fail closed (never match)
 * rather than silently matching everything - a typo in a filter should mean
 * "delivers nothing", not "delivers everything". */
function evaluateCondition({ field, operator = 'is', value }, event) {
  const actual = event[field];
  switch (operator) {
    case 'is':
      return actual === value;
    case 'not':
      return actual !== value;
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(value);
      if (typeof actual === 'string') return actual.includes(value);
      return false;
    default:
      return false;
  }
}

/** ANDs all conditions in filters.conditions against an event's data. An empty/absent
 * filter list matches everything (no filtering configured = deliver every event). */
function matchesFilters(filters, event) {
  const conditions = filters?.conditions || [];
  if (conditions.length === 0) return true;
  return conditions.every((condition) => evaluateCondition(condition, event));
}

module.exports = { matchesFilters, evaluateCondition };
