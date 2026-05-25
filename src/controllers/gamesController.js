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
        opponent_score,
        status,
        current_period,
        clock_sec_remaining,
        is_clock_running,
        last_clock_started_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
        game.opponentScore,
        game.status ?? "FINISHED",
        game.currentPeriod,
        game.clockSecRemaining,
        game.isClockRunning,
        game.lastClockStartedAt,
      ],
    );

    res.json({
      remoteId: result.rows[0].id,
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
      [teamScore, opponentScore, remoteId],
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
        opponent_score,
        status,
        current_period,
        clock_sec_remaining,
        is_clock_running,
        last_clock_started_at
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

    await pool.query("DELETE FROM events WHERE game_remote_id = $1", [
      remoteId,
    ]);
    await pool.query("DELETE FROM roster WHERE game_remote_id = $1", [
      remoteId,
    ]);
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
    g.id,
    g.local_id,
    g.opponent_name,
    g.is_home_game,
    g.round_number,
    g.game_date_epoch,
    g.team_score,
    g.opponent_score,
    g.quarter_length_sec,
    g.quarters_count,
    g.status,
    g.current_period,
    g.clock_sec_remaining,
    g.is_clock_running,
    g.last_clock_started_at,

    COALESCE(SUM(
      CASE
        WHEN e.type = 'TWO_MADE' THEN 2
        WHEN e.type = 'THREE_MADE' THEN 3
        WHEN e.type = 'FT_MADE' THEN 1
        ELSE 0
      END
    ), 0) AS live_team_score,

    COALESCE(SUM(
      CASE
        WHEN e.type = 'OPP_TWO_MADE' THEN 2
        WHEN e.type = 'OPP_THREE_MADE' THEN 3
        WHEN e.type = 'OPP_FT_MADE' THEN 1
        ELSE 0
      END
    ), 0) AS live_opponent_score

  FROM games g
  LEFT JOIN events e
    ON e.game_remote_id = g.id

  WHERE g.id = $1
    AND g.is_deleted = false

  GROUP BY
    g.id,
    g.local_id,
    g.opponent_name,
    g.is_home_game,
    g.round_number,
    g.game_date_epoch,
    g.team_score,
    g.opponent_score,
    g.quarter_length_sec,
    g.quarters_count,
    g.status,
    g.current_period,
    g.clock_sec_remaining,
    g.is_clock_running,
    g.last_clock_started_at
  `,
      [gameId],
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
    COALESCE(SUM(CASE WHEN e.type = 'PF' THEN 1 ELSE 0 END), 0) AS fouls,

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
      [gameId],
    );

    const eventsResult = await pool.query(
      `
  SELECT
    e.id,
    e.type,
    e.period,
    e.clock_sec_remaining,
    e.team_score_at_event,
    e.opponent_score_at_event,
    e.created_at,
    p.id AS player_id,
    p.name AS player_name,
    p.number AS player_number
  FROM events e
  LEFT JOIN players p
    ON p.id = e.player_remote_id
  WHERE e.game_remote_id = $1
  AND e.type IN (
    'TWO_MADE',
    'THREE_MADE',
    'FT_MADE',
    'OPP_TWO_MADE',
    'OPP_THREE_MADE',
    'OPP_FT_MADE',
    'PERIOD_END',
    'PERIOD_START',
    'SUB_IN',
    'SUB_OUT'
  )
  ORDER BY e.period ASC, e.clock_sec_remaining DESC, e.created_at ASC
  `,
      [gameId],
    );

    return res.json({
      game: gameResult.rows[0],
      players: playersResult.rows,
      events: eventsResult.rows,
    });
  } catch (error) {
    console.error("Error fetching game stats:", error);
    return res.status(500).json({
      message: "Failed to fetch game stats",
    });
  }
};

export const getHomeGame = async (req, res) => {
  try {
    const lastGameResult = await pool.query(`
      SELECT
        g.id,
        g.opponent_name,
        g.is_home_game,
        g.round_number,
        g.game_date_epoch,
        g.team_score,
        g.opponent_score,
        g.status,
        g.current_period,
        g.clock_sec_remaining,
        g.is_clock_running,
        g.last_clock_started_at,

        COALESCE(SUM(
          CASE
            WHEN e.type = 'TWO_MADE' THEN 2
            WHEN e.type = 'THREE_MADE' THEN 3
            WHEN e.type = 'FT_MADE' THEN 1
            ELSE 0
          END
        ), 0) AS live_team_score,

        COALESCE(SUM(
          CASE
            WHEN e.type = 'OPP_TWO_MADE' THEN 2
            WHEN e.type = 'OPP_THREE_MADE' THEN 3
            WHEN e.type = 'OPP_FT_MADE' THEN 1
            ELSE 0
          END
        ), 0) AS live_opponent_score

      FROM games g
      LEFT JOIN events e
        ON e.game_remote_id = g.id

      WHERE g.is_deleted = false

      GROUP BY
        g.id,
        g.opponent_name,
        g.is_home_game,
        g.round_number,
        g.game_date_epoch,
        g.team_score,
        g.opponent_score,
        g.status,
        g.current_period,
        g.clock_sec_remaining,
        g.is_clock_running,
        g.last_clock_started_at

      ORDER BY
        CASE WHEN g.status = 'LIVE' THEN 0 ELSE 1 END,
        g.game_date_epoch DESC

      LIMIT 1
    `);

    const game = lastGameResult.rows[0] ?? null;

    return res.json({
      type: game?.status === "LIVE" ? "LIVE" : "LAST_GAME",
      game,
    });
  } catch (error) {
    console.error("Error fetching home game:", error);
    return res.status(500).json({
      message: "Failed to fetch home game",
      error: error.message,
    });
  }
};

export const updateGame = async (req, res) => {
  try {
    console.log("updateGame body:", req.body);
    const { remoteId } = req.params;
    const game = req.body;

    const result = await pool.query(
      `
      UPDATE games
SET
  opponent_name = $1,
  is_home_game = $2,
  round_number = $3,
  game_date_epoch = $4,
  created_at = $5,
  quarter_length_sec = $6,
  quarters_count = $7,
  team_score = $8,
  opponent_score = $9,
  status = $10,
  current_period = $11,
  clock_sec_remaining = $12,
  is_clock_running = $13,
  last_clock_started_at = $14
WHERE id = $15
RETURNING id
      `,
      [
        game.opponentName,
        game.isHomeGame,
        game.roundNumber,
        game.gameDateEpoch,
        game.createdAt,
        game.quarterLengthSec,
        game.quartersCount,
        game.teamScore,
        game.opponentScore,
        game.status ?? "FINISHED",
        game.currentPeriod,
        game.clockSecRemaining,
        game.isClockRunning,
        game.lastClockStartedAt,
        remoteId,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Game not found" });
    }

    res.json({
      remoteId: result.rows[0].id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update game" });
  }
};
