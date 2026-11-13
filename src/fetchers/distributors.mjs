// Distributors (downline network) -> two calls:
//   A) GET /member/genealogy  -> the full team TREE rooted at the current account
//      (every member, nested via children[]; carries bv, gbv, rank, status,
//      team_size). This is the complete list, so we flatten it into one row per
//      member with its parent_code + depth level.
//   B) GET /member/downline   -> the DIRECT downline only, but it adds `joined_on`
//      (the genealogy nodes omit it). We merge that date onto the matching rows.
//
// Returns rows shaped for upsertDistributors(). The account's own node is the
// tree root (level 0, no parent); everyone under it is level >= 1.
import { apiGet } from "../api/client.mjs";

export async function fetchDistributors(token) {
  const g = await apiGet(token, "/member/genealogy");

  // Flatten the tree depth-first into one row per member.
  const rows = [];
  const walk = (node, parentCode, level) => {
    if (!node || !node.member_code) return;
    rows.push({
      memberCode: node.member_code,
      name: node.name ?? null,
      rank: node.rank ?? null,
      status: node.status ?? null,
      bv: node.bv ?? null,
      gbv: node.gbv ?? null,
      teamSize: node.team_size ?? null,
      parentCode, // null for the root (the account itself)
      level,
      joinedOn: null, // filled from /member/downline below when available
    });
    for (const child of node.children ?? []) walk(child, node.member_code, level + 1);
  };
  walk(g.root, null, 0);

  // Enrich with joined_on where the directory exposes it (direct downline only).
  try {
    const dl = await apiGet(token, "/member/downline");
    const joinedByCode = new Map(
      (dl.direct ?? []).map((d) => [d.member_code, d.joined_on ?? null]),
    );
    for (const r of rows) {
      if (joinedByCode.has(r.memberCode)) r.joinedOn = joinedByCode.get(r.memberCode);
    }
  } catch {
    // joined_on is a nice-to-have; a downline failure must not drop the tree.
  }

  return rows;
}
