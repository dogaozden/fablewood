export function deriveMastery(entry, now) {
  if (!entry) {
    return { box: 0, due: null, last_event: null, status: 'unseen' };
  }
  // Upper clamp tracks the SRS ladder's max box (8 since the lifetime-ladder extension);
  // the ledger reports state, it doesn't enforce ladder shape — clamp only guards garbage.
  const box = Number.isFinite(entry.box) ? Math.min(Math.max(entry.box, 1), 8) : 1;
  const nextDue = Number.isFinite(entry.next_due) ? entry.next_due : -Infinity;
  const isOverdue = nextDue <= now;
  const status = isOverdue ? 'overdue' : box >= 3 ? 'known' : 'learning';
  const due = Number.isFinite(entry.next_due) ? new Date(entry.next_due).toISOString() : null;
  const lastEvent = entry.history && entry.history.length
    ? entry.history[entry.history.length - 1].ts
    : null;
  return { box, due, last_event: lastEvent, status };
}
