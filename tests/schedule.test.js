import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureValues, loadSchedule, importSchedule } from '../src/scheduleImport.js';
test('26/27 schedule has nine dated rounds and correct home/away assignment', async () => {
  const fixtures = await loadSchedule();
  assert.equal(fixtures.length, 9);
  assert.deepEqual(fixtures.map(f => f.roundNumber), [1,2,3,4,5,6,7,8,9]);
  assert.equal(fixtures.filter(f => f.isHomeGame).length, 5);
  assert.equal(fixtures[0].date, '2026-11-26');
  assert.equal(fixtures[8].date, '2027-03-18');
  for (const f of fixtures) {
    const row = fixtureValues(f, 100);
    assert.equal(row.status, 'SCHEDULED');
    assert.doesNotMatch(row.opponent_name, /[\u0590-\u05ff]/);
    assert.equal(row.season, '26/27');
    assert.equal(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jerusalem'}).format(row.game_date_epoch), f.date);
    assert.equal(row.is_clock_running, false);
  }
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
