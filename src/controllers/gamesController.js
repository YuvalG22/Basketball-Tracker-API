import pool from "../db.js";

export const createGame = async (req, res) => {
  try {
    const game = req.body;

    const result = await pool.query(
      `
      INSERT INTO games (
        local_id,
        opponent_name,
        is_home_game,
        round_number,
        game_date_epoch,
        created_at,
        quarter_length_sec,
        quarters_count,
        team_score,
        opponent_score
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
      `,
      [
        game.localId ?? null,
        game.opponentName,
        game.isHomeGame,
        game.roundNumber,
        game.gameDateEpoch,
        game.createdAt,
        game.quarterLengthSec,
        game.quartersCount,
        game.teamScore,
        game.opponentScore
      ]
    );

    res.json({
      remoteId: result.rows[0].id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create game" });
  }
};

export const updateGameScore = async (req, res) => {
  try {
    const { remoteId, teamScore, opponentScore } = req.body;

    await pool.query(
      `
      UPDATE games
      SET team_score = $1,
          opponent_score = $2
      WHERE id = $3
      `,
      [teamScore, opponentScore, remoteId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update game score" });
  }
};

export const getGames = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        local_id,
        opponent_name,
        is_home_game,
        round_number,
        game_date_epoch,
        created_at,
        quarter_length_sec,
        quarters_count,
        team_score,
        opponent_score
      FROM games
      WHERE is_deleted = false
      ORDER BY created_at ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch games" });
  }
};

export const deleteGame = async (req, res) => {
  try {
    const { remoteId } = req.params;

    await pool.query("DELETE FROM events WHERE game_remote_id = $1", [remoteId]);
    await pool.query("DELETE FROM roster WHERE game_remote_id = $1", [remoteId]);
    await pool.query("DELETE FROM games WHERE id = $1", [remoteId]);

    res.json({ success: true });
  } catch (err) {
    console.error("deleteGame error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getGameStats = async (req, res) => {
  try {
    const { gameId } = req.params;

    const gameResult = await pool.query(
      `
      SELECT
        id,
        local_id,
        opponent_name,
        is_home_game,
        round_number,
        game_date_epoch,
        team_score,
        opponent_score,
        quarter_length_sec,
        quarters_count
      FROM games
      WHERE id = $1
        AND is_deleted = false
      `,
      [gameId]
    );

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ message: "Game not found" });
    }

    const playersResult = await pool.query(
  `
  SELECT
    p.id AS player_id,
    p.name AS player_name,
    p.number AS player_number,

    COALESCE(SUM(
      CASE
        WHEN e.type = 'TWO_MADE' THEN 2
        WHEN e.type = 'THREE_MADE' THEN 3
        WHEN e.type = 'FT_MADE' THEN 1
        ELSE 0
      END
    ), 0) AS points,

    COALESCE(SUM(
      CASE
        WHEN e.type = 'REB_DEF' THEN 1
        WHEN e.type = 'REB_OFF' THEN 1
        ELSE 0
      END
    ), 0) AS rebounds,
    COALESCE(SUM(CASE WHEN e.type = 'AST' THEN 1 ELSE 0 END), 0) AS assists,
    COALESCE(SUM(CASE WHEN e.type = 'STL' THEN 1 ELSE 0 END), 0) AS steals,
    COALESCE(SUM(CASE WHEN e.type = 'BLK' THEN 1 ELSE 0 END), 0) AS blocks,
    COALESCE(SUM(CASE WHEN e.type = 'TOV' THEN 1 ELSE 0 END), 0) AS turnovers,

    COALESCE(SUM(CASE WHEN e.type = 'TWO_MADE' THEN 1 ELSE 0 END), 0) AS two_made,
    COALESCE(SUM(CASE WHEN e.type = 'TWO_MISS' THEN 1 ELSE 0 END), 0) AS two_miss,
    COALESCE(SUM(CASE WHEN e.type = 'THREE_MADE' THEN 1 ELSE 0 END), 0) AS three_made,
    COALESCE(SUM(CASE WHEN e.type = 'THREE_MISS' THEN 1 ELSE 0 END), 0) AS three_miss,

    COALESCE(SUM(CASE WHEN e.type = 'FT_MADE' THEN 1 ELSE 0 END), 0) AS ft_made,
    COALESCE(SUM(CASE WHEN e.type = 'FT_MISS' THEN 1 ELSE 0 END), 0) AS ft_miss

  FROM roster r

  JOIN players p
    ON p.id = r.player_remote_id

  LEFT JOIN events e
    ON e.player_remote_id = r.player_remote_id
   AND e.game_remote_id = r.game_remote_id

  WHERE r.game_remote_id = $1

  GROUP BY
    p.id,
    p.name,
    p.number

  ORDER BY p.number ASC
  `,
  [gameId]
);

    return res.json({
      game: gameResult.rows[0],
      players: playersResult.rows,
    });
  } catch (error) {
    console.error("Error fetching game stats:", error);
    return res.status(500).json({
      message: "Failed to fetch game stats",
    });
  }
};