import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, endpoint, validateRevision } from '../src/syncStore.js';
import { getGameStats } from '../src/controllers/gamesController.js';

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
