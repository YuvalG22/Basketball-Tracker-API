import pool from "../db.js";

export const createEvent = async (req, res) => {
  try {
    const event = req.body;

    const result = await pool.query(
      `
      INSERT INTO events (
        local_id,
        game_id,
        player_id,
        type,
        period,
        clock_sec_remaining,
        created_at,
        team_score_at_event,
        opponent_score_at_event,
        shot_x,
        shot_y,
        shot_distance
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
      `,
      [
        event.localId ?? null,
        event.gameId,
        event.playerId,
        event.type,
        event.period,
        event.clockSecRemaining,
        event.createdAt,
        event.teamScoreAtEvent,
        event.opponentScoreAtEvent,
        event.shotX,
        event.shotY,
        event.shotDistance
      ]
    );

    res.json({
      remoteId: result.rows[0].id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create event" });
  }
};

export const getEvents = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id,
        e.local_id,
        e.game_id AS local_game_id,
        e.player_id AS local_player_id,
        g.id AS game_remote_id,
        p.id AS player_remote_id,
        e.type,
        e.period,
        e.clock_sec_remaining,
        e.created_at,
        e.team_score_at_event,
        e.opponent_score_at_event,
        e.shot_x,
        e.shot_y,
        e.shot_distance
      FROM events e
      JOIN games g ON g.local_id = e.game_id
      LEFT JOIN players p ON p.local_id = e.player_id
      ORDER BY e.created_at ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
};