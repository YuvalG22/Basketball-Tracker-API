import test from 'node:test';
import assert from 'node:assert/strict';
import {updatePlayer} from '../src/controllers/playersController.js';

async function update(extra) {
  const queries=[];
  const old={id:'p',server_version:4,is_deleted:false};
  const db={release(){},async query(sql,args){queries.push({sql,args});return {rows:sql.startsWith('SELECT')?[old]:sql.startsWith('UPDATE')?[{...old,server_version:5,last_mutation_version:5,client_revision:1}]:[]};}};
  const result={};
  await updatePlayer({params:{remoteId:'p'},body:{name:'Player',number:7,clientRevision:1,expectedServerVersion:4,...extra},database:{connect:async()=>db}}, {status(n){result.status=n;return this;},json(body){result.body=body;}});
  return {queries,result};
}
test('season memberships use versioned player updates while legacy edits leave membership intact',async()=>{
  const memberships={'25/26':'active','26/27':'left'};
  const {queries,result}=await update({seasonMemberships:memberships});
  assert.equal(result.body.serverVersion,5);
  const mutation=queries.find(q=>q.sql.startsWith('UPDATE'));
  assert.match(mutation.sql,/season_memberships=/);
  assert.ok(mutation.args.includes(JSON.stringify(memberships)));
  const legacy=await update({});
  assert.doesNotMatch(legacy.queries.find(q=>q.sql.startsWith('UPDATE')).sql,/season_memberships/);
});
test('invalid membership payloads roll back without saving',async()=>{
  for(const seasonMemberships of [[],null,{'26/27':'deleted'},{'invalid':'active'}]) {
    const {queries,result}=await update({seasonMemberships});
    assert.equal(result.status,400);
    assert.ok(queries.some(q=>q.sql==='ROLLBACK'));
    assert.ok(!queries.some(q=>q.sql.startsWith('UPDATE')));
  }
});
