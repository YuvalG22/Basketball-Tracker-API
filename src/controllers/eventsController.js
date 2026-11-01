import pool from "../db.js";
import {endpoint,createRecord,requireGame,refreshScore,preserveRecordedScore,HttpError,validateRevision} from "../syncStore.js";
const types=new Set(["FT_MADE","FT_MISS","TWO_MADE","TWO_MISS","THREE_MADE","THREE_MISS","REB_OFF","REB_DEF","AST","STL","TOV","BLK","PF","SUB_IN","SUB_OUT","OPP_TWO_MADE","OPP_THREE_MADE","OPP_FT_MADE","OPP_TWO_MISS","OPP_THREE_MISS","OPP_FT_MISS","OPP_PF","PERIOD_START","PERIOD_END"]);
const scoring=new Set(["TWO_MADE","THREE_MADE","FT_MADE","OPP_TWO_MADE","OPP_THREE_MADE","OPP_FT_MADE"]);
async function saveEvent(db,req){
 const e=req.body;validateRevision(e);
 if(!types.has(e.type)||!Number.isInteger(e.period)||e.period<1||!Number.isInteger(e.clockSecRemaining)||e.clockSecRemaining<0||!Number.isSafeInteger(e.createdAt)) throw new HttpError(400,"Invalid event");
 const replay=e.syncKey?(await db.query("SELECT 1 FROM events WHERE sync_key=$1",[e.syncKey])).rows.length:false;
 await requireGame(db,e.gameRemoteId,replay?null:e.expectedGameVersion);
 if((e.playerId!=null&&!e.playerRemoteId)||(e.assistedByPlayerId!=null&&!e.assistedByPlayerRemoteId)) throw new HttpError(400,"Unresolved player reference");
 const result=await createRecord(db,"events",{
 local_id:e.localId??null,game_id:e.gameId,player_id:e.playerId??null,
 assisted_by_player_id:e.assistedByPlayerId??null,assisted_by_player_remote_id:e.assistedByPlayerRemoteId??null,
 game_remote_id:e.gameRemoteId,player_remote_id:e.playerRemoteId??null,type:e.type,period:e.period,
 clock_sec_remaining:e.clockSecRemaining,created_at:e.createdAt,team_score_at_event:e.teamScoreAtEvent??null,
 opponent_score_at_event:e.opponentScoreAtEvent??null,shot_x:e.shotX??null,shot_y:e.shotY??null,
 shot_distance:e.shotDistance??null,action_group_id:e.actionGroupId??null
 },e.syncKey??req.get("Idempotency-Key"),e.clientRevision??0);
 if(scoring.has(e.type))await refreshScore(db,e.gameRemoteId);
 return result;
}
async function acknowledgeGame(db,gameId,results){
 const changed=results.some(r=>r.created&&!r.isDeleted);
 const row=await db.query(changed?"UPDATE games SET server_version=server_version+1 WHERE id=$1 RETURNING server_version":"SELECT server_version FROM games WHERE id=$1",[gameId]);
 const version=Number(row.rows[0].server_version);
 const created=results.filter(r=>r.created&&!r.isDeleted).map(r=>r.remoteId);
 if(created.length)await db.query("UPDATE events SET game_version=$1 WHERE id=ANY($2::uuid[])",[version,created]);
 const rows=await db.query("SELECT id,game_version FROM events WHERE id=ANY($1::uuid[])",[results.map(r=>r.remoteId)]);
 return results.map(r=>({...r,gameServerVersion:r.isDeleted?null:Number(rows.rows.find(e=>e.id===r.remoteId)?.game_version??version)}));
}
export const acknowledgeEvents=endpoint(async(db,req)=>{
 if(!Array.isArray(req.body)||req.body.length>100)throw new HttpError(400,"Invalid acknowledgement query");
 return (await db.query('SELECT e.sync_key AS "syncKey",e.id AS "remoteId",e.game_remote_id AS "gameRemoteId",CASE WHEN e.is_deleted THEN t.game_version ELSE e.game_version END AS "gameServerVersion",e.is_deleted AS "isDeleted" FROM events e LEFT JOIN event_tombstones t ON t.sync_key=e.sync_key WHERE e.sync_key=ANY($1::text[])',[req.body])).rows;
});
export const createEvent=endpoint(async(db,req)=>{
 const result=await saveEvent(db,req);
 return (await acknowledgeGame(db,req.body.gameRemoteId,[result]))[0];
});
export const createEvents=endpoint(async(db,req)=>{
 if(!Array.isArray(req.body)||req.body.length<1||req.body.length>100)throw new HttpError(400,"Invalid event batch");
 if(new Set(req.body.map(e=>e.gameRemoteId)).size!==1)throw new HttpError(400,"One game per batch");
 const results=[];
 for(const body of req.body)results.push(await saveEvent(db,{body,get:()=>null}));
 return acknowledgeGame(db,req.body[0].gameRemoteId,results);
});
export const deleteEvents=endpoint(async(db,req)=>{
 if(!Array.isArray(req.body)||req.body.length>100)throw new HttpError(400,"Invalid deletion batch");
 const keys=req.body.map(e=>e.syncKey).filter(Boolean).sort();
 const ids=req.body.map(e=>e.remoteId).filter(Boolean);
 const existing=await db.query("SELECT sync_key,game_remote_id FROM events WHERE sync_key=ANY($1::text[]) OR id=ANY($2::uuid[])",[keys,ids]);
 for(const item of req.body)if(item.syncKey&&!item.gameRemoteId&&!existing.rows.some(e=>e.sync_key===item.syncKey))
   throw new HttpError(400,"Game identity required for an unacknowledged event");
 const gameIds=[...new Set([...req.body.map(e=>e.gameRemoteId),...existing.rows.map(e=>e.game_remote_id)].filter(Boolean))].sort();
 for(const id of gameIds)await db.query("SELECT id FROM games WHERE id=$1 FOR UPDATE",[id]);
 const active=await db.query("SELECT game_remote_id FROM events WHERE (sync_key=ANY($1::text[]) OR id=ANY($2::uuid[])) AND NOT is_deleted",[keys,ids]);
 for(const item of req.body)if(item.expectedGameVersion!=null&&active.rows.some(e=>e.game_remote_id===item.gameRemoteId))
   await requireGame(db,item.gameRemoteId,item.expectedGameVersion);
 for(const key of keys){
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["events:"+key]);
   const gameId=req.body.find(e=>e.syncKey===key)?.gameRemoteId??existing.rows.find(e=>e.sync_key===key)?.game_remote_id;
   await db.query("INSERT INTO event_tombstones(sync_key,game_remote_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[key,gameId]);
 }
 await db.query("UPDATE events SET is_deleted=true,server_version=server_version+1 WHERE (sync_key=ANY($1::text[]) OR id=ANY($2::uuid[])) AND NOT is_deleted",[keys,ids]);
 const gameVersions={};
 for(const id of gameIds){
   await preserveRecordedScore(db,id);
   if(active.rows.some(e=>e.game_remote_id===id)){
     const row=await db.query("UPDATE games SET server_version=server_version+1 WHERE id=$1 RETURNING server_version",[id]);
     await db.query("UPDATE event_tombstones SET game_version=$1 WHERE sync_key=ANY($2::text[]) AND game_remote_id=$3 AND game_version IS NULL",[row.rows[0].server_version,keys,id]);
   }
 }
 const receipts=await db.query("SELECT game_remote_id,MAX(game_version) AS version FROM event_tombstones WHERE sync_key=ANY($1::text[]) AND game_version IS NOT NULL GROUP BY game_remote_id",[keys]);
 for(const row of receipts.rows)gameVersions[row.game_remote_id]=Number(row.version);
 return {success:true,gameVersions};
});
export const getEvents=async(req,res,next)=>{
 try{res.json((await(req.database||pool).query("SELECT e.*,e.game_id AS local_game_id,e.player_id AS local_player_id FROM events e JOIN games g ON g.id=e.game_remote_id WHERE ($1 OR (NOT e.is_deleted AND NOT g.is_deleted)) ORDER BY e.period,e.clock_sec_remaining DESC,e.created_at,COALESCE(e.local_id,0),e.id",[req.query.includeDeleted==="true"])).rows);}catch(e){next(e);}
};
export const deleteEvent=endpoint(async(db,req)=>{
 const found=await db.query("SELECT game_remote_id,type FROM events WHERE id=$1",[req.params.remoteId]);
 if(!found.rows.length)return {success:true};
 await db.query("SELECT id FROM games WHERE id=$1 FOR UPDATE",[found.rows[0].game_remote_id]);
 await db.query("UPDATE events SET is_deleted=true,server_version=server_version+1 WHERE id=$1 AND NOT is_deleted",[req.params.remoteId]);
 if(scoring.has(found.rows[0].type))await refreshScore(db,found.rows[0].game_remote_id);
 await db.query("UPDATE games SET server_version=server_version+1 WHERE id=$1",[found.rows[0].game_remote_id]);
 return {success:true};
});
