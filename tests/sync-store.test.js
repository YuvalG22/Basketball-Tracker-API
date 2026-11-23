import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, endpoint, validateRevision } from '../src/syncStore.js';
import { getGameStats } from '../src/controllers/gamesController.js';
import { createEvents } from '../src/controllers/eventsController.js';

test('opponent rebounds and drawn fouls sync with the correct player references without changing the score', async () => {
  const inserted = [];
  const queries = [];
  const connection = {
    async query(sql, args = []) {
      queries.push(sql);
      if (sql.startsWith('SELECT * FROM games')) return { rows: [{ id: 'game', server_version: 1 }] };
      if (sql.startsWith('INSERT INTO events')) {
        const columns = sql.match(/\(([^)]+)\) VALUES/)[1].split(',');
        const row = { ...Object.fromEntries(columns.map((column, index) => [column, args[index]])),
          id: `event-${inserted.length}`, server_version: 0, is_deleted: false };
        inserted.push(row);
        return { rows: [row] };
      }
      if (sql.startsWith('UPDATE games')) return { rows: [{ server_version: 2 }] };
      if (sql.startsWith('SELECT id,game_version FROM events'))
        return { rows: inserted.map(row => ({ id: row.id, game_version: 2 })) };
      return { rows: [] };
    },
    release() {},
  };
  let status = 200, body;
  await createEvents({
    database: { connect: async () => connection },
    body: ['OPP_REB_O', 'OPP_REB_D', 'PF_DRAWN'].map((type, index) => ({
      type, gameId: 1, gameRemoteId: 'game', period: 1, clockSecRemaining: 500,
      ...(type === 'PF_DRAWN' ? {playerId: 2, playerRemoteId: 'player-2'} : {}),
      createdAt: index + 1, syncKey: `rebound-${index}`,
    })),
  }, { status(value) { status = value; return this; }, json(value) { body = value; } });
  assert.equal(status, 200);
  assert.equal(body.length, 3);
  assert.deepEqual(inserted.map(row => row.type), ['OPP_REB_O', 'OPP_REB_D', 'PF_DRAWN']);
  assert.ok(inserted.slice(0, 2).every(row => row.player_id === null && row.player_remote_id === null));
  assert.equal(inserted[2].player_id, 2);
  assert.equal(inserted[2].player_remote_id, 'player-2');
  assert.ok(!queries.some(sql => sql.includes('team_score=')));
});

test('drawn fouls require a player and are exposed in game, quarter and season statistics', async () => {
  const { getPlayerStats } = await import('../src/controllers/playersController.js');
  const { getSeasonStats } = await import('../src/controllers/statsController.js');
  const queries = [];
  const game = {game_id:'game',points:0,rebounds:0,assists:0,steals:0,blocks:0,turnovers:0,fouls:1,fouls_drawn:3};
  const database = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM players')) return {rows:[{id:'player'}]};
      if (sql.includes('g.id AS game_id')) return {rows:[game]};
      if (sql.includes('GROUP BY e.game_remote_id, e.period')) return {rows:[{game_remote_id:'game',period:2,fouls_drawn:3}]};
      return {rows:[]};
    },
  };
  let body;
  const response = {json(value){body=value;},status(){return this;}};
  await getPlayerStats({params:{playerId:'player'},query:{season:'26/27'},database},response);
  assert.equal(body.games[0].fouls_drawn,3);
  assert.equal(body.games[0].periods[0].fouls_drawn,3);
  assert.equal(body.totals.foulsDrawn,3);
  assert.equal(body.averages.fdpg,3);
  for (const sql of queries.filter(sql => sql.includes('g.id AS game_id') || sql.includes('GROUP BY e.game_remote_id, e.period')))
    assert.match(sql,/PF_DRAWN.*fouls_drawn/);
  await getSeasonStats({query:{season:'26/27'},database},response,error=>{throw error;});
  assert.match(queries.at(-1),/PF_DRAWN.*pf_drawn/);

  let status = 200;
  const connection = {async query(sql) {
    return {rows:sql.startsWith('SELECT * FROM games')?[{id:'game',server_version:0}]:[]};
  },release(){}};
  await createEvents({database:{connect:async()=>connection},body:[{
    type:'PF_DRAWN',gameRemoteId:'game',period:1,clockSecRemaining:500,createdAt:1,
  }]},{status(value){status=value;return this;},json(value){body=value;}});
  assert.equal(status,400);
  assert.equal(body.error,'Foul drawn requires a player');
});

test('game details expose source ordering IDs for scoring and lineup events', async () => {
  const queries=[];
  const database={query:async sql=>{
    queries.push(sql);
    return {rows:sql.includes('FROM games g')?[{id:'game'}]:[]};
  }};
  let status=200,body;
  await getGameStats({params:{gameId:'game'},database},{
    status(value){status=value;return this;},json(value){body=value;}
  });
  assert.equal(status,200);
  assert.deepEqual(body.events,[]);
  assert.deepEqual(body.lineupEvents,[]);
  const eventQueries=queries.filter(sql=>sql.includes('ORDER BY e.period'));
  assert.equal(eventQueries.length,2);
  for(const sql of eventQueries){
    assert.match(sql,/SELECT\s+e\.id,\s+e\.local_id,/);
    assert.match(sql,/e\.is_deleted = false/);
    assert.match(sql,/e\.created_at ASC, COALESCE\(e\.local_id,0\) ASC, e\.id ASC/);
  }
  assert.ok(queries.some(sql=>sql.includes("'PF_DRAWN'") && sql.includes('AS fouls_drawn')));
  assert.ok(eventQueries.some(sql=>sql.includes("'PF_DRAWN'") && sql.includes("'OPP_PF'")));
});

test('transaction rolls back a network/database failure and always releases the connection',async()=>{
  const calls=[];const database={connect:async()=>({query:async sql=>calls.push(sql),release:()=>calls.push('release')})};
  await assert.rejects(transaction(async()=>{throw new Error('connection interrupted');},database));
  assert.deepEqual(calls,['BEGIN','ROLLBACK','release']);
});
test('HTTP failure is explicit and does not expose database details',async()=>{
  const database={connect:async()=>({query:async()=>{},release(){}})};
  let status,body;
  await endpoint(async()=>{throw Object.assign(new Error('private SQL'),{code:'23503'});})({database},{status(n){status=n;return this;},json(value){body=value;}});
  assert.equal(status,400);assert.deepEqual(body,{error:'Request could not be saved'});
});
test('invalid client revisions are rejected',()=>{
  for(const clientRevision of [-1,0.5,'1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateRevision({clientRevision}));
  validateRevision({clientRevision:1});validateRevision({});
});

test('player details attach only recorded quarter stats to their matching game',async()=>{
  const {getPlayerStats}=await import('../src/controllers/playersController.js');
  const period={game_remote_id:'game',period:2,points:'3',three_made:'1',shots:[]};
  const queries=[];
  const database={query:async(sql,args)=>{
    queries.push(sql);assert.deepEqual(args,sql.includes('FROM players')?['player']:['player',null]);
    if(sql.includes('FROM players'))return {rows:[{id:'player',name:'Shooter'}]};
    if(sql.includes('g.id AS game_id'))return {rows:[{game_id:'game',points:'3',rebounds:0,assists:0,steals:0,blocks:0,turnovers:0},{game_id:'legacy',points:0,rebounds:0,assists:0,steals:0,blocks:0,turnovers:0}]};
    if(sql.includes('GROUP BY e.game_remote_id, e.period'))return {rows:[period]};
    return {rows:[]};
  }};
  let body;await getPlayerStats({params:{playerId:'player'},database},{json(value){body=value;},status(){return this;}});
  assert.deepEqual(body.games[0].periods,[period]);assert.deepEqual(body.games[1].periods,[]);
  const sql=queries.find(sql=>sql.includes('GROUP BY e.game_remote_id, e.period'));
  assert.match(sql,/g.status = 'FINISHED'/);assert.match(sql,/NOT e.is_deleted/);
  assert.match(sql,/player_remote_id = \$1 AND NOT is_deleted/);
  assert.match(sql,/e.period > 0/);
});

test('player season filter applies to totals, shots and periods while metadata remains unfiltered',async()=>{
  const {getPlayerStats}=await import('../src/controllers/playersController.js');
  for(const season of ['26/27','25/26',undefined]) {
    const calls=[];let body;
    await getPlayerStats({params:{playerId:'p'},query:{season},database:{query:async(sql,args)=>{
      calls.push({sql,args});return {rows:sql.includes('FROM players')?[{id:'p',name:'Player'}]:[]};
    }}},{json(value){body=value;},status(){return this;}});
    assert.equal(body.player.id,'p');assert.deepEqual(body.games,[]);
    const stats=calls.filter(({sql})=>!sql.includes('FROM players'));
    assert.equal(stats.length,3);
    for(const {sql,args} of stats){assert.match(sql,/\(\$2::text IS NULL OR g.season = \$2\)/);assert.deepEqual(args,['p',season??null]);}
  }
});
