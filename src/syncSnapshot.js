export async function getSnapshot(db) {
  // One SQL statement uses one PostgreSQL MVCC snapshot for parents and children.
  const result = await db.query(`SELECT
    COALESCE((SELECT jsonb_agg(p ORDER BY p.id) FROM players p),'[]') AS players,
    COALESCE((SELECT jsonb_agg(g ORDER BY g.id) FROM games g),'[]') AS games,
    COALESCE((SELECT jsonb_agg(r) FROM
      (SELECT DISTINCT ON (game_remote_id,player_remote_id) * FROM roster
       ORDER BY game_remote_id,player_remote_id,created_at,id) r),'[]') AS roster,
    COALESCE((SELECT jsonb_agg(e ORDER BY e.period,e.clock_sec_remaining DESC,e.created_at,COALESCE(e.local_id,0),e.id) FROM
      (SELECT events.*,game_id AS local_game_id,player_id AS local_player_id FROM events) e),'[]') AS events`);
  return result.rows[0];
}
