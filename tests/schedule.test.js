import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureValues, loadSchedule, importSchedule } from '../src/scheduleImport.js';
test('26/27 schedule has nine dated rounds and correct home/away assignment', async () => {
  const fixtures = await loadSchedule();
  assert.equal(fixtures.length, 9);
  assert.deepEqual(fixtures.map(f => f.roundNumber), [1,2,3,4,5,6,7,8,9]);
  assert.equal(fixtures.filter(f => f.isHomeGame).length, 5);
  assert.equal(fixtures[0].date, '2026-11-27');
  assert.equal(fixtures[8].date, '2027-03-19');
  assert.equal(fixtures.filter(f => f.time != null).length, 7);
  for (const f of fixtures) {
    const row = fixtureValues(f, 100);
    assert.equal(row.status, 'SCHEDULED');
    assert.doesNotMatch(row.opponent_name, /[\u0590-\u05ff]/);
    assert.equal(row.season, '26/27');
    assert.equal(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jerusalem'}).format(row.game_date_epoch), f.date);
    assert.equal(new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Jerusalem', hour:'2-digit', minute:'2-digit', second:'2-digit'}).format(row.game_date_epoch), f.time ?? '00:00:00');
    assert.equal(row.is_clock_running, false);
  }
});

test('fixture times reject invalid hours and keep unknown times date-only', async () => {
  const [fixture] = await loadSchedule();
  for (const time of ['24:00:00', '10:60:00', 'not-a-time', '']) assert.throws(() => fixtureValues({...fixture, time}), /Invalid fixture time/);
  assert.equal(fixtureValues({...fixture, time:null}).game_date_epoch, Date.parse(`${fixture.date}T00:00:00+02:00`));
});

test('explicit rescheduling updates only unstarted fixtures and is idempotent', async () => {
  const fixtures = await loadSchedule();
  const rows = new Map(fixtures.map((fixture, index) => {
    const row = { ...fixtureValues(fixture), id:index+1, sync_key:`easycoach:${fixture.season}:${fixture.matchId}`, game_date_epoch:100, server_version:3 };
    return [row.sync_key, row];
  }));
  const records = [...rows.values()];
  records[0].status='LIVE'; records[0].team_score=7;
  records[1].status='FINISHED'; records[2].is_deleted=true; records[3].hasEvents=true;
  const protectedBefore = JSON.stringify(records.slice(0,4));
  const db = { async query(sql, args) {
    if (sql.startsWith('SELECT pg_advisory')) return {rows:[]};
    if (sql.startsWith('SELECT * FROM games WHERE sync_key')) return {rows:[rows.get(args[0])]};
    if (sql.startsWith('UPDATE games SET game_date_epoch')) {
      const row=rows.get(args[0]);
      if(row.status!=='SCHEDULED'||row.is_deleted||row.hasEvents||row.game_date_epoch===args[1]) return {rows:[]};
      row.game_date_epoch=args[1]; row.server_version++;
      return {rows:[{id:row.id}]};
    }
    assert.fail(sql);
  }};
  assert.deepEqual(await importSchedule(db, fixtures, {updateScheduled:true}), {inserted:0,updated:5,preserved:4});
  assert.equal(JSON.stringify(records.slice(0,4)), protectedBefore);
  assert.ok(records.slice(4).every(row=>row.server_version===4));
  assert.deepEqual(await importSchedule(db, fixtures, {updateScheduled:true}), {inserted:0,updated:0,preserved:9});
});
test('import retries preserve existing live, finished and deleted fixtures', async () => {
  const fixtures = await loadSchedule();
  const rows = new Map();
  const db = { async query(sql, args) {
    if (sql.startsWith('SELECT pg_advisory')) return {rows:[]};
    if (sql.startsWith('SELECT * FROM games WHERE sync_key')) return {rows:rows.has(args[0])?[rows.get(args[0])]:[]};
    const columns = sql.match(/INSERT INTO games \(([^)]+)\)/)?.[1].split(',');
    assert.ok(columns, sql);
    const row = Object.fromEntries(columns.map((c,i) => [c,args[i]]));
    row.id = rows.size + 1; row.server_version = 0;
    rows.set(row.sync_key, row);
    return {rows:[row]};
  }};
  assert.deepEqual(await importSchedule(db, fixtures), {inserted:9,preserved:0});
  const original = [...rows.values()];
  original[0].status='LIVE'; original[0].team_score=7;
  original[1].status='FINISHED'; original[2].is_deleted=true;
  const before = JSON.stringify(original);
  assert.deepEqual(await importSchedule(db, fixtures), {inserted:0,preserved:9});
  assert.equal(JSON.stringify([...rows.values()]), before);
  assert.equal(rows.size, 9);
});
