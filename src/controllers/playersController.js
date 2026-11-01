import pool from "../db.js";
import {endpoint,createRecord,updateRecord,HttpError,validateRevision} from "../syncStore.js";
function playerValues(p){
 validateRevision(p);
 if(typeof p.name!=="string"||!p.name.trim()||!Number.isInteger(p.number)||p.number<0)throw new HttpError(400,"Invalid player");
 return {name:p.name,number:p.number};
}
export const createPlayer=endpoint((db,req)=>createRecord(db,"players",{...playerValues(req.body),local_id:req.body.localId??null,created_at:req.body.createdAt??Date.now()},req.body.syncKey??req.get("Idempotency-Key"),req.body.clientRevision??0));
export const updatePlayer=endpoint((db,req)=>updateRecord(db,"players",req.params.remoteId,playerValues(req.body),req.body));
export const deletePlayer=endpoint(async(db,req)=>{
 await db.query("UPDATE players SET is_deleted=true,server_version=server_version+1 WHERE id=$1 AND NOT is_deleted",[req.params.remoteId]);
 return {success:true};
});
export const getPlayers = async (req, res) => {
  try {
    const result = await (req.database || pool).query(`
      SELECT
        id,
        local_id,
        name,
        number,
        created_at, sync_key, server_version, client_revision, is_deleted
      FROM players
      WHERE ($1 OR NOT is_deleted)
      ORDER BY id ASC
    `, [req.query.includeDeleted === "true"]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch players" });
  }
};

export const getPlayerStats = async (req, res) => {
  try {
    const { playerId } = req.params;

    const playerResult = await (req.database || pool).query(
      `
      SELECT
        id,
        local_id,
        name,
        number
      FROM players
      WHERE id = $1
      `,
      [playerId],
    );

    if (playerResult.rows.length === 0) {
      return res.status(404).json({ message: "Player not found" });
    }

    const gamesResult = await (req.database || pool).query(
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

      FROM (SELECT DISTINCT game_remote_id,player_remote_id FROM roster WHERE NOT is_deleted) r

      JOIN games g
        ON g.id = r.game_remote_id

      LEFT JOIN events e
        ON e.game_remote_id = r.game_remote_id
       AND e.player_remote_id = r.player_remote_id AND e.is_deleted = false

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
      [playerId],
    );

    const shotsResult = await (req.database || pool).query(
      `
  SELECT
    game_remote_id,
    type,
    shot_x,
    shot_y
  FROM events
  WHERE player_remote_id = $1
    AND is_deleted = false AND type IN ('TWO_MADE', 'TWO_MISS', 'THREE_MADE', 'THREE_MISS')
    AND shot_x IS NOT NULL
    AND shot_y IS NOT NULL
  `,
      [playerId],
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
      },
    );

    const averages = {
      ppg: totals.gamesPlayed
        ? +(totals.points / totals.gamesPlayed).toFixed(1)
        : 0,
      rpg: totals.gamesPlayed
        ? +(totals.rebounds / totals.gamesPlayed).toFixed(1)
        : 0,
      apg: totals.gamesPlayed
        ? +(totals.assists / totals.gamesPlayed).toFixed(1)
        : 0,
      spg: totals.gamesPlayed
        ? +(totals.steals / totals.gamesPlayed).toFixed(1)
        : 0,
      bpg: totals.gamesPlayed
        ? +(totals.blocks / totals.gamesPlayed).toFixed(1)
        : 0,
      tpg: totals.gamesPlayed
        ? +(totals.turnovers / totals.gamesPlayed).toFixed(1)
        : 0,
    };

    const shotsByGame = shotsResult.rows.reduce((acc, shot) => {
      if (!acc[shot.game_remote_id]) {
        acc[shot.game_remote_id] = [];
      }

      acc[shot.game_remote_id].push(shot);
      return acc;
    }, {});

    const gamesWithShots = games.map((game) => ({
      ...game,
      shots: shotsByGame[game.game_id] ?? [],
    }));

    return res.json({
      player: playerResult.rows[0],
      totals,
      averages,
      games: gamesWithShots,
    });
  } catch (error) {
    console.error("Error fetching player stats:", error);
    return res.status(500).json({
      message: "Failed to fetch player stats",
      error: error.message,
    });
  }
};
