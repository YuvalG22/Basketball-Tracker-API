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
      ORDER BY created_at ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch games" });
  }
};