import pool from "../db.js";
import {endpoint,createRecord,updateRecord,preserveRecordedScore,HttpError,validateRevision} from "../syncStore.js";
function values(g){
 validateRevision(g);
 if(typeof g.opponentName!=="string"||!g.opponentName.trim()||!["SCHEDULED","LIVE","FINISHED"].includes(g.status??"FINISHED")||!Number.isInteger(g.currentPeriod??1)||(g.currentPeriod??1)<1||!Number.isInteger(g.clockSecRemaining??600)||(g.clockSecRemaining??600)<0)throw new HttpError(400,"Invalid game");
 return {opponent_name:g.opponentName,is_home_game:g.isHomeGame??false,round_number:g.roundNumber,
 is_playoff:g.isPlayoff??false,playoff_stage:g.playoffStage??null,playoff_game_number:g.playoffGameNumber??null,
 game_date_epoch:g.gameDateEpoch,created_at:g.createdAt,quarter_length_sec:g.quarterLengthSec??600,quarters_count:g.quartersCount??4,
 team_score:g.teamScore??0,opponent_score:g.opponentScore??0,status:g.status??"FINISHED",current_period:g.currentPeriod??1,
 clock_sec_remaining:g.clockSecRemaining??600,is_clock_running:g.isClockRunning??false,last_clock_started_at:g.lastClockStartedAt??null,
 ...(g.season!=null?{season:g.season}:{})};
}
export const createGame=endpoint((db,req)=>createRecord(db,"games",{local_id:req.body.localId??null,...values(req.body)},req.body.syncKey??req.get("Idempotency-Key"),req.body.clientRevision??0));
export const updateGame=endpoint(async(db,req)=>{
 const result=await updateRecord(db,"games",req.params.remoteId,values(req.body),req.body);
 await preserveRecordedScore(db,req.params.remoteId);return result;
});
export const updateGameScore=endpoint(async(db,req)=>{
 const r=req.body;const result=await updateRecord(db,"games",r.remoteId,{team_score:r.teamScore,opponent_score:r.opponentScore},r);
 await preserveRecordedScore(db,r.remoteId);return {...result,success:true};
});
export const getGames = async (req, res) => {
  try {
    const result = await (req.database || pool).query(`
      SELECT
        id,
        local_id, sync_key, server_version, client_revision, is_deleted, season,
        opponent_name,
        is_home_game,
        round_number,
        is_playoff,
        playoff_stage,
        playoff_game_number,
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
      WHERE ($1 OR is_deleted = false)
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at ASC
    `, [req.query.includeDeleted === "true", req.query.status === "FINISHED" ? "FINISHED" : null]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch games" });
  }
};

export const deleteGame=endpoint(async(db,req)=>{
 const id=req.params.remoteId;
 await db.query("SELECT id FROM games WHERE id=$1 FOR UPDATE",[id]);
 await db.query("UPDATE games SET is_deleted=true,is_clock_running=false,server_version=server_version+1 WHERE id=$1 AND NOT is_deleted",[id]);
 await db.query("UPDATE events SET is_deleted=true WHERE game_remote_id=$1",[id]);
 await db.query("UPDATE roster SET is_deleted=true WHERE game_remote_id=$1",[id]);
 return {success:true};
});

export const getGameStats = async (req, res) => {
  try {
    const { gameId } = req.params;

    const gameResult = await (req.database || pool).query(
      `
  SELECT
    g.id,
    g.local_id,
    g.opponent_name,
    g.is_home_game,
    g.round_number,
    g.is_playoff,
    g.playoff_stage,
    g.playoff_game_number,
    g.game_date_epoch,
    g.team_score,
    g.opponent_score,
    g.quarter_length_sec,
    g.quarters_count,
    g.status
  FROM games g
  WHERE g.id = $1
    AND g.is_deleted = false
    AND g.status = 'FINISHED'
  `,
      [gameId],
    );

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ message: "Game not found" });
    }

    const playersResult = await (req.database || pool).query(
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

  FROM (SELECT DISTINCT game_remote_id,player_remote_id FROM roster WHERE NOT is_deleted) r

  JOIN players p
    ON p.id = r.player_remote_id

  LEFT JOIN events e
    ON e.player_remote_id = r.player_remote_id
   AND e.game_remote_id = r.game_remote_id AND e.is_deleted = false

  WHERE r.game_remote_id = $1

  GROUP BY
    p.id,
    p.name,
    p.number

  ORDER BY p.number ASC
  `,
      [gameId],
    );

    const eventsResult = await (req.database || pool).query(
      `
  SELECT
    e.id,
    e.local_id,
    e.type,
    e.period,
    e.assisted_by_player_remote_id,
    e.clock_sec_remaining,
    e.team_score_at_event,
    e.opponent_score_at_event,
    e.created_at,

    p.name AS player_name,
    p.number AS player_number,

    assist_player.name AS assist_player_name,
    assist_player.number AS assist_player_number

  FROM events e

  LEFT JOIN players p
    ON p.id = e.player_remote_id

  LEFT JOIN players assist_player
    ON assist_player.id = e.assisted_by_player_remote_id

  WHERE e.game_remote_id = $1 AND e.is_deleted = false
    AND e.type IN (
      'TWO_MADE',
      'THREE_MADE',
      'FT_MADE',
      'OPP_TWO_MADE',
      'OPP_THREE_MADE',
      'OPP_FT_MADE',
      'PERIOD_END',
      'PERIOD_START'
    )

  ORDER BY e.period ASC, e.clock_sec_remaining DESC, e.created_at ASC, COALESCE(e.local_id,0) ASC, e.id ASC
  `,
      [gameId],
    );

    const lineupEventsResult = await (req.database || pool).query(
      `
  SELECT
    e.id,
    e.local_id,
    e.type,
    e.period,
    e.clock_sec_remaining,
    e.created_at,
    p.id AS player_id,
    p.name AS player_name,
    p.number AS player_number
  FROM events e
  JOIN players p
    ON p.id = e.player_remote_id
  WHERE e.game_remote_id = $1 AND e.is_deleted = false
    AND e.type IN ('SUB_IN', 'SUB_OUT')
  ORDER BY e.period ASC, e.clock_sec_remaining DESC, e.created_at ASC, COALESCE(e.local_id,0) ASC, e.id ASC
  `,
      [gameId],
    );

    return res.json({
      game: gameResult.rows[0],
      players: playersResult.rows,
      events: eventsResult.rows,
      lineupEvents: lineupEventsResult.rows,
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
    const result = await (req.database || pool).query(`
      SELECT id, opponent_name, is_home_game, round_number,
        is_playoff, playoff_stage, playoff_game_number, game_date_epoch,
        team_score, opponent_score, status
      FROM games
      WHERE is_deleted = false AND status = 'FINISHED'
      ORDER BY game_date_epoch DESC, created_at DESC, id DESC
      LIMIT 1
    `);
    return res.json({ type: "LAST_GAME", game: result.rows[0] ?? null });
  } catch (error) {
    console.error("Error fetching home game:", error);
    return res.status(500).json({ message: "Failed to fetch home game" });
  }
};
