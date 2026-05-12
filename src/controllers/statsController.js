const pool = require("../db");

const getSeasonStats = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        player_id,
        player_name,
        player_number,
        gp,
        pts,
        ast,
        reb_total,
        reb_def,
        reb_off,
        stl,
        blk,
        tov,
        pf,
        fgm,
        fga,
        threem,
        threea,
        ftm,
        fta
      FROM player_season_stats
      ORDER BY pts DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching season stats:", err);
    res.status(500).json({ error: "Failed to fetch season stats" });
  }
};

const refreshSeasonStats = async (req, res) => {
  try {
    await pool.query(`
      REFRESH MATERIALIZED VIEW CONCURRENTLY player_season_stats
    `);

    res.json({ success: true });
  } catch (err) {
    console.error("Error refreshing season stats:", err);
    res.status(500).json({ error: "Failed to refresh season stats" });
  }
};

module.exports = {
  getSeasonStats,
  refreshSeasonStats
};