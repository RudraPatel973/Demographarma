/** Finished visits open the read-only summary; unfinished ones open the live workspace. */
export function visitHref(v: { id: string; status: string }) {
  return ["prescribed", "completed"].includes(v.status) ? `/visits/${v.id}/summary` : `/visits/${v.id}`;
}
