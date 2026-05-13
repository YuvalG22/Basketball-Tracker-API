import pool from "../db.js";

export const createPlayer = async (req, res) => {
  try {
    const player = req.body;

    const result = await pool.query(
      `
      INSERT INTO players (
        local_id,
        name,
        number,
        created_at
      )
      VALUES ($1,$2,$3,$4)
      RETURNING id
      `,
      [
        player.localId ?? null,
        player.name,
        player.number,
        player.createdAt
      ]
    );

    res.json({
      remoteId: result.rows[0].id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create player" });
  }
};

export const getPlayers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        local_id,
        name,
        number,
        created_at
      FROM players
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch players" });
  }
};

export const getPlayerStats = async (req, res) => {
  try {
    const { playerId } = req.params;

    const playerResult = await pool.query(
      `
      SELECT
        id,
        local_id,
        name,
        number
      FROM players
      WHERE id = $1
      `,
      [playerId]
    );

    if (playerResult.rows.length === 0) {
      return res.status(404).json({ message: "Player not found" });
    }

    const gamesResult = await pool.query(
      `
      SELECT
        g.id AS game_id,
        g.opponent_name,
        g.round_number,
        g.game_date_epoch,
        g.team_score,
        g.opponent_score,

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

        COALESCE(SUM(CASE WHEN e.type = 'REB_DEF' THEN 1 ELSE 0 END), 0) AS defensive_rebounds,
        COALESCE(SUM(CASE WHEN e.type = 'REB_OFF' THEN 1 ELSE 0 END), 0) AS offensive_rebounds,

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

      JOIN games g
        ON g.id = r.game_remote_id

      LEFT JOIN events e
        ON e.game_remote_id = r.game_remote_id
       AND e.player_remote_id = r.player_remote_id

      WHERE r.player_remote_id = $1
        AND g.is_deleted = false

      GROUP BY
        g.id,
        g.opponent_name,
        g.round_number,
        g.game_date_epoch,
        g.team_score,
        g.opponent_score

      ORDER BY g.game_date_epoch DESC
      `,
      [playerId]
    );

    const games = gamesResult.rows;

    const totals = games.reduce(
      (acc, game) => {
        acc.gamesPlayed += 1;
        acc.points += Number(game.points);
        acc.rebounds += Number(game.rebounds);
        acc.assists += Number(game.assists);
        acc.steals += Number(game.steals);
        acc.blocks += Number(game.blocks);
        acc.turnovers += Number(game.turnovers);
        return acc;
      },
      {
        gamesPlayed: 0,
        points: 0,
        rebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
      }
    );

    const averages = {
      ppg: totals.gamesPlayed ? +(totals.points / totals.gamesPlayed).toFixed(1) : 0,
      rpg: totals.gamesPlayed ? +(totals.rebounds / totals.gamesPlayed).toFixed(1) : 0,
      apg: totals.gamesPlayed ? +(totals.assists / totals.gamesPlayed).toFixed(1) : 0,
      spg: totals.gamesPlayed ? +(totals.steals / totals.gamesPlayed).toFixed(1) : 0,
      bpg: totals.gamesPlayed ? +(totals.blocks / totals.gamesPlayed).toFixed(1) : 0,
      tpg: totals.gamesPlayed ? +(totals.turnovers / totals.gamesPlayed).toFixed(1) : 0,
    };

    return res.json({
      player: playerResult.rows[0],
      totals,
      averages,
      games,
    });
  } catch (error) {
    console.error("Error fetching player stats:", error);
    return res.status(500).json({
      message: "Failed to fetch player stats",
      error: error.message,
    });
  }
};