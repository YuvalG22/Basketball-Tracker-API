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