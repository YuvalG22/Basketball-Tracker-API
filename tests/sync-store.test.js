import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, endpoint, validateRevision } from '../src/syncStore.js';

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
