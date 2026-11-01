import pool from "../db.js";
import {endpoint,createRecord,requireGame,HttpError} from "../syncStore.js";
export const createRoster=endpoint(async(db,req)=>{
 const r=req.body;await requireGame(db,r.gameRemoteId);
 const player=await db.query("SELECT id FROM players WHERE id=$1 AND NOT is_deleted",[r.playerRemoteId]);
 if(!player.rows.length)throw new HttpError(409,"Player unavailable");
 const key=r.gameRemoteId+"/"+r.playerRemoteId;
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);
 const old=await db.query("SELECT * FROM roster WHERE game_remote_id=$1 AND player_remote_id=$2 ORDER BY created_at,id LIMIT 1",[r.gameRemoteId,r.playerRemoteId]);
 if(old.rows.length)return {remoteId:old.rows[0].id,isDeleted:old.rows[0].is_deleted};
 return createRecord(db,"roster",{local_game_id:r.gameId,local_player_id:r.playerId,game_remote_id:r.gameRemoteId,player_remote_id:r.playerRemoteId,created_at:r.createdAt??Date.now()},key);
});
export const getRoster=async(req,res,next)=>{
 try{res.json((await(req.database||pool).query("SELECT DISTINCT ON (r.game_remote_id,r.player_remote_id) r.* FROM roster r JOIN games g ON g.id=r.game_remote_id WHERE ($1 OR (NOT r.is_deleted AND NOT g.is_deleted)) ORDER BY r.game_remote_id,r.player_remote_id,r.created_at,r.id",[req.query.includeDeleted==="true"])).rows);}catch(e){next(e);}
};
