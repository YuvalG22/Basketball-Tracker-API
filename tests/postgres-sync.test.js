import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { migrateSyncSchema } from '../src/syncSchema.js';
import { getSnapshot } from '../src/syncSnapshot.js';
import { mutationAcknowledgements } from '../src/syncStore.js';
import { createPlayer, updatePlayer, deletePlayer, getPlayers, getPlayerStats } from '../src/controllers/playersController.js';
import { createGame, updateGame, deleteGame, getGames, getGameStats, getHomeGame } from '../src/controllers/gamesController.js';
import { createEvent, createEvents, deleteEvents, acknowledgeEvents, getEvents } from '../src/controllers/eventsController.js';
import { createRoster, getRoster } from '../src/controllers/rosterController.js';
import { getSeasonStats } from '../src/controllers/statsController.js';

// All writes target session-private TEMP tables. The outer transaction is always
// rolled back; the deployed schema, view, and all existing rows remain untouched.
let db, database;
before(async () => {
  db = await pool.connect();
  await db.query('BEGIN');
  await db.query('SET LOCAL search_path = pg_temp');
  for (const table of ['games', 'players', 'events', 'roster'])
    await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  await migrateSyncSchema(db, {lock:false});
  await migrateSyncSchema(db, {lock:false}); // Migration is repeatable.
  database = { query: (...args) => db.query(...args), connect: async () => ({
    query: (sql, args) => db.query(sql === 'BEGIN' ? 'SAVEPOINT request' :
      sql === 'COMMIT' ? 'RELEASE SAVEPOINT request' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT request' : sql, args),
    release() {}
  }) };
});
after(async () => { if (db) { await db.query('ROLLBACK'); db.release(); } await pool.end(); });

async function call(handler, body = {}, params = {}, query = {}) {
  const result = { status: 200 };
  await handler({ body, params, query, database, get: () => null }, {
    status(value) { result.status = value; return this; }, json(value) { result.body = value; }
  }, error => { throw error; });
  return result;
}
const player = () => ({ localId:1, name:'Test player', number:7, createdAt:1, syncKey:randomUUID(), clientRevision:0 });
const game = () => ({ localId:1, opponentName:'Test opponents', isHomeGame:true, roundNumber:1,
  gameDateEpoch:1,createdAt:1,quarterLengthSec:600,quartersCount:4,teamScore:0,opponentScore:0,
  status:'LIVE',currentPeriod:1,clockSecRemaining:600,isClockRunning:false,
  season:'26/27',syncKey:randomUUID(),clientRevision:0 });
const event = (g,p) => ({localId:1,gameId:1,playerId:1,gameRemoteId:g,playerRemoteId:p,
  type:'TWO_MADE',period:1,clockSecRemaining:500,createdAt:100,syncKey:randomUUID(),actionGroupId:randomUUID()});

test('PostgreSQL: retries, lost responses, revisions, tombstones, joins and snapshots', async t => {
  const p=player(), g=game();
  const pr=(await call(createPlayer,p)).body, gr=(await call(createGame,g)).body;
  assert.ok(pr.remoteId && gr.remoteId);

  await t.test('lost create acknowledgements return the original identity and applied revision', async()=>{
    assert.deepEqual((await call(createPlayer,{...p,name:'Newer unsent edit',clientRevision:1})).body,pr);
    assert.deepEqual((await call(createGame,g)).body,gr);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM players WHERE sync_key=$1',[p.syncKey])).rows[0].n,1);
  });
  await t.test('updates are idempotent; stale second-device edits conflict',async()=>{
    const body={...p,name:'Updated',clientRevision:1,expectedServerVersion:0,mutationKey:p.syncKey+':1'};
    const first=await call(updatePlayer,body,{remoteId:pr.remoteId});
    assert.equal(first.status,200);assert.equal(first.body.serverVersion,1);
    assert.deepEqual(await call(updatePlayer,body,{remoteId:pr.remoteId}),first);
    assert.equal((await call(updatePlayer,{...body,mutationKey:'other-device'},{remoteId:pr.remoteId})).status,409);
  });
  let er;
  await t.test('event batches retry without duplication and roll back completely on failure',async()=>{
    const e=event(gr.remoteId,pr.remoteId);
    const assist={...event(gr.remoteId,pr.remoteId),type:'AST',actionGroupId:e.actionGroupId,createdAt:101};
    er=(await call(createEvents,[e,assist])).body;
    assert.deepEqual((await call(createEvents,[e,assist])).body,er);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM events WHERE game_remote_id=$1',[gr.remoteId])).rows[0].n,2);
    const broken=event(gr.remoteId,pr.remoteId);
    assert.equal((await call(createEvents,[broken,{...broken,syncKey:randomUUID(),type:'INVALID'}])).status,400);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM events WHERE sync_key=$1',[broken.syncKey])).rows[0].n,0);
  });
  await t.test('roster identity is remote membership, not colliding device-local integers',async()=>{
    const r={gameId:1,playerId:1,gameRemoteId:gr.remoteId,playerRemoteId:pr.remoteId};
    const first=await call(createRoster,r);
    assert.equal((await call(createRoster,{...r,gameId:999,playerId:999})).body.remoteId,first.body.remoteId);
    const other=(await call(createPlayer,player())).body;
    assert.equal((await call(createRoster,{...r,playerRemoteId:other.remoteId})).status,200);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM roster WHERE game_remote_id=$1',[gr.remoteId])).rows[0].n,2);
  });
  await t.test('an unknown assist player is rejected without saving a partial event',async()=>{
    const invalid={...event(gr.remoteId,pr.remoteId),assistedByPlayerId:999,assistedByPlayerRemoteId:randomUUID()};
    assert.equal((await call(createEvent,invalid)).status,400);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM events WHERE sync_key=$1',[invalid.syncKey])).rows[0].n,0);
  });
  await t.test('stale score payloads cannot overwrite recorded events; clocks and seasons survive',async()=>{
    const body={...g,status:'FINISHED',clockSecRemaining:88,teamScore:99,clientRevision:1,expectedServerVersion:1,mutationKey:g.syncKey+':1'};
    assert.equal((await call(updateGame,body,{remoteId:gr.remoteId})).status,200);
    const row=(await db.query('SELECT * FROM games WHERE id=$1',[gr.remoteId])).rows[0];
    assert.equal(row.team_score,2);assert.equal(row.clock_sec_remaining,88);assert.equal(row.season,'26/27');
    assert.equal((await call(updateGame,{...body,mutationKey:'stale'},{remoteId:gr.remoteId})).status,409);
  });
  await t.test('update receipts retain their commit version after subsequent events',async()=>{
    const request={...event(gr.remoteId,pr.remoteId),type:'SUB_IN',expectedGameVersion:2};
    assert.equal((await call(createEvent,request)).status,200);
    const receipts=(await call(mutationAcknowledgements,[{table:'games',remoteId:gr.remoteId,mutationKey:g.syncKey+':1'}])).body;
    assert.equal(Number(receipts[0].serverVersion),2);
    assert.equal(Number((await db.query('SELECT server_version FROM games WHERE id=$1',[gr.remoteId])).rows[0].server_version),3);
  });
  await t.test('all legacy read routes and computed statistics execute against the migrated schema',async()=>{
    for(const handler of [getPlayers,getGames,getEvents,getRoster,getHomeGame,getSeasonStats]) {
      const result=await call(handler);assert.equal(result.status,200,handler.name);assert.ok(result.body);
    }
    assert.equal((await call(getGameStats,{}, {gameId:gr.remoteId})).status,200);
    assert.equal((await call(getPlayerStats,{}, {playerId:pr.remoteId})).status,200);
    const stats=(await call(getSeasonStats)).body.find(row=>row.player_id===pr.remoteId);
    assert.equal(stats.pts,2);assert.equal(stats.ast,1);
  });
  await t.test('undo by stable key works without remote acknowledgement, is atomic and cannot resurrect on retry',async()=>{
    const rows=(await db.query('SELECT sync_key AS "syncKey",id AS "remoteId" FROM events WHERE game_remote_id=$1',[gr.remoteId])).rows;
    const deletion=await call(deleteEvents,rows.map(row=>({syncKey:row.syncKey})));
    assert.equal(deletion.status,200);
    assert.equal((await call(deleteEvents,rows)).status,200);
    const key=rows[0].syncKey;
    const old=(await db.query('SELECT * FROM events WHERE sync_key=$1',[key])).rows[0];
    const replay={...event(gr.remoteId,pr.remoteId),syncKey:key,type:old.type,createdAt:Number(old.created_at)};
    assert.equal((await call(createEvent,replay)).body.isDeleted,true);
    assert.equal((await db.query('SELECT team_score FROM games WHERE id=$1',[gr.remoteId])).rows[0].team_score,0);
    const stats=(await call(getSeasonStats)).body.find(row=>row.player_id===pr.remoteId);
    assert.equal(stats.pts,0);assert.equal(stats.ast,0);
  });
  await t.test('delete-before-upload leaves a durable key tombstone and stale concurrent actions are rejected',async()=>{
    const e=event(gr.remoteId,pr.remoteId);
    assert.equal((await call(deleteEvents,[{syncKey:e.syncKey,gameRemoteId:gr.remoteId}])).status,200);
    assert.equal((await call(createEvent,e)).body.isDeleted,true);
    const ack=(await call(acknowledgeEvents,[e.syncKey])).body[0];
    assert.equal(ack.isDeleted,true);assert.equal(ack.gameServerVersion,null);
    const version=Number((await db.query('SELECT server_version FROM games WHERE id=$1',[gr.remoteId])).rows[0].server_version);
    const first=event(gr.remoteId,pr.remoteId);
    assert.equal((await call(createEvent,{...first,expectedGameVersion:version})).status,200);
    assert.equal((await call(createEvent,{...event(gr.remoteId,pr.remoteId),expectedGameVersion:version})).status,409);
  });
  await t.test('player deletion archives identity and preserves historical references',async()=>{
    assert.equal((await call(deletePlayer,{}, {remoteId:pr.remoteId})).status,200);
    assert.equal((await call(createPlayer,p)).body.isDeleted,true);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM roster WHERE player_remote_id=$1',[pr.remoteId])).rows[0].n,1);
  });
  await t.test('game deletion retains tombstones, rejects late children, and snapshots remain relationally complete',async()=>{
    assert.equal((await call(deleteGame,{}, {remoteId:gr.remoteId})).status,200);
    assert.equal((await call(deleteGame,{}, {remoteId:gr.remoteId})).status,200);
    assert.equal((await call(createGame,g)).body.isDeleted,true);
    assert.equal((await call(createEvent,event(gr.remoteId,pr.remoteId))).status,409);
    const snapshot=await getSnapshot(db);
    assert.ok(snapshot.games.find(row=>row.id===gr.remoteId).is_deleted);
    assert.ok(snapshot.events.every(row=>snapshot.games.some(g=>g.id===row.game_remote_id)));
    assert.ok(snapshot.events.filter(row=>row.game_remote_id===gr.remoteId).every(row=>row.is_deleted));
  });
});


test('historical Web REST reads exclude unfinished games while Android sync retains them', async () => {
  const { createApp } = await import('../src/app.js');
  const p = (await call(createPlayer, player())).body.remoteId;
  const finished = (await call(createGame, {...game(), status:'FINISHED', gameDateEpoch:200})).body.remoteId;
  const ongoing = (await call(createGame, {...game(), gameDateEpoch:300})).body.remoteId;
  for (const id of [finished, ongoing]) {
    assert.equal((await call(createRoster, {gameId:1,playerId:1,gameRemoteId:id,playerRemoteId:p})).status,200);
  }
  const types = ['TWO_MADE','THREE_MADE','FT_MADE','TWO_MISS','THREE_MISS','FT_MISS',
    'REB_DEF','REB_OFF','AST','STL','BLK','TOV','PF','SUB_IN','SUB_OUT'];
  const batch = types.map((type,index) => ({...event(finished,p),type,localId:index+1,
    createdAt:1000+index, period:type==='THREE_MADE'?5:1,
    clockSecRemaining:500-index, shotX:type.includes('MADE')?0.5:null,shotY:type.includes('MADE')?0.4:null}));
  assert.equal((await call(createEvents,batch)).status,200);
  assert.equal((await call(createEvent,event(ongoing,p))).status,200);
  const server = createApp(database).listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  async function get(url) { const response=await fetch(base+url); assert.equal(response.status,200,url); return response.json(); }
  try {
    const home=await get('/games/home');
    assert.equal(home.type,'LAST_GAME');assert.equal(home.game.id,finished);
    assert.ok(!('live_team_score' in home.game));assert.ok(!('clock_sec_remaining' in home.game));
    const history=await get('/games?status=FINISHED');
    assert.ok(history.some(g=>g.id===finished));assert.ok(history.every(g=>g.status==='FINISHED'));
    const androidGames=await get('/games?includeDeleted=true');
    assert.ok(androidGames.some(g=>g.id===ongoing && g.status==='LIVE' && g.current_period===1 && g.clock_sec_remaining===600));
    const detail=await get('/games/'+finished);
    assert.equal(detail.game.id,finished);assert.equal(Number(detail.game.team_score),6);
    assert.ok(!('live_team_score' in detail.game));
    const box=detail.players.find(row=>row.player_id===p);
    for(const [key,value] of Object.entries({points:6,rebounds:2,assists:1,steals:1,blocks:1,turnovers:1,fouls:1,two_made:1,two_miss:1,three_made:1,three_miss:1,ft_made:1,ft_miss:1})) assert.equal(Number(box[key]),value,key);
    assert.ok(detail.events.some(e=>e.period===5));
    assert.equal(detail.lineupEvents.length,2);
    assert.ok([...detail.events,...detail.lineupEvents].every(e=>Object.hasOwn(e,'local_id')));
    const activeIds=(await db.query('SELECT id FROM events WHERE game_remote_id=$1 AND NOT is_deleted',[finished])).rows.map(e=>e.id);
    assert.ok([...detail.events,...detail.lineupEvents].every(e=>activeIds.includes(e.id)));
    assert.equal((await fetch(base+'/games/'+ongoing)).status,404);
    const profile=await get('/players/'+p);
    assert.equal(profile.games.length,1);assert.equal(profile.games[0].game_id,finished);
    assert.equal(profile.averages.ppg,6);assert.equal(profile.averages.rpg,2);
    assert.equal(profile.games[0].shots.length,2);
    assert.ok(profile.games[0].shots.every(s=>s.game_remote_id===finished));
    assert.ok((await get('/players')).some(row=>row.id===p));
    const season=(await get('/stats/season')).find(row=>row.player_id===p);
    assert.equal(season.pts,6);assert.equal(season.gp,1);assert.equal(season.fgm,2);assert.equal(season.fga,4);
    const snapshot=await get('/sync/snapshot');
    assert.ok(snapshot.games.some(g=>g.id===ongoing && g.status==='LIVE'));
    assert.ok(snapshot.events.some(e=>e.game_remote_id===ongoing));
  } finally { await new Promise(resolve=>server.close(resolve)); }
  await db.query('UPDATE games SET is_deleted=true WHERE id=ANY($1::uuid[])',[[finished,ongoing]]);
  assert.deepEqual((await call(getHomeGame)).body,{type:'LAST_GAME',game:null});
});
