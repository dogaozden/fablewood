export function matchesQuery(fact, query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (fact.statement.toLowerCase().includes(q)) return true;
  if (fact.detail && fact.detail.toLowerCase().includes(q)) return true;
  const tags = fact.tags ?? [];
  if (tags.some((tag) => tag.toLowerCase().includes(q))) return true;
  if (tags.some((tag) => tag.toLowerCase() === q)) return true;
  return false;
}
