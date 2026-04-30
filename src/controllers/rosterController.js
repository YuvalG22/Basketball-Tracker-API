import pool from "../db.js";

export const createRoster = async (req, res) => {
  try {
    const roster = req.body;

    const result = await pool.query(
      `
      INSERT INTO roster (
        local_game_id,
        local_player_id,
        created_at
      )
      VALUES ($1,$2,$3)
      ON CONFLICT (local_game_id, local_player_id)
      DO UPDATE SET created_at = EXCLUDED.created_at
      RETURNING id
      `,
      [
        roster.gameId,
        roster.playerId,
        roster.createdAt
      ]
    );

    res.json({
      remoteId: result.rows[0].id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create roster" });
  }
};

export const getRoster = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.local_game_id,
        r.local_player_id,
        g.id AS game_remote_id,
        p.id AS player_remote_id,
        r.created_at
      FROM roster r
      JOIN games g ON g.local_id = r.local_game_id
      JOIN players p ON p.local_id = r.local_player_id
      ORDER BY r.created_at ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch roster" });
  }
};