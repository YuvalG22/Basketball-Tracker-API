// Counts are aggregated across every non-deleted event, including unassigned events.
export function buildTeamStats(game, rows) {
  const counts = Object.fromEntries(rows.map(row => [row.type, Number(row.count)]));
  const n = type => counts[type] ?? 0;
  const opponentScoring = ["TWO", "THREE", "FT"].some(type => n(`OPP_${type}_MADE`) > 0);
  const shooting = (type, opponent) => {
    const prefix = opponent ? "OPP_" : "";
    const made = opponent && !opponentScoring ? null : n(`${prefix}${type}_MADE`);
    const miss = n(`${prefix}${type}_MISS`);
    const attempts = made != null && (!opponent || miss > 0) ? made + miss : null;
    return { made, attempts, percentage: attempts > 0 && made != null ? made / attempts * 100 : null };
  };
  const team = opponent => {
    const two = shooting("TWO", opponent), three = shooting("THREE", opponent), ft = shooting("FT", opponent);
    const made = two.made == null || three.made == null ? null : two.made + three.made;
    const attempts = two.attempts == null || three.attempts == null ? null : two.attempts + three.attempts;
    return {
      points: Number((opponent ? game.opponent_score : game.team_score) ?? 0),
      fg: { made, attempts, percentage: attempts > 0 && made != null ? made / attempts * 100 : null }, two, three, ft,
      rebounds: opponent ? null : n("REB_OFF") + n("REB_DEF"),
      offensive_rebounds: opponent ? null : n("REB_OFF"), defensive_rebounds: opponent ? null : n("REB_DEF"),
      assists: opponent ? null : n("AST"), steals: opponent ? null : n("STL"), blocks: opponent ? null : n("BLK"),
      turnovers: opponent ? null : n("TOV"), fouls: opponent ? n("OPP_PF") || null : n("PF"),
    };
  };
  return { afeka: team(false), opponent: team(true) };
}
