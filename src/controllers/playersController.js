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
      ORDER BY number ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch players" });
  }
};