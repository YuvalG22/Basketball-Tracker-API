// Shared by the explicit import command and offline tests. No automatic fixture import.
import { readFile } from 'node:fs/promises';
import { createRecord } from './syncStore.js';
export async function loadSchedule() {
  return JSON.parse(await readFile(new URL('../data/schedule-26-27.json', import.meta.url), 'utf8'));
}
export function fixtureValues(fixture, createdAt = Date.now()) {
  if (!fixture.matchId || fixture.season !== '26/27' || !fixture.opponentName?.trim() ||
      typeof fixture.isHomeGame !== 'boolean' || !Number.isInteger(fixture.roundNumber) || fixture.roundNumber < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fixture.date)) throw new Error('Invalid fixture');
  // All fixtures are in Israeli standard time (November through March 18).
  const epoch = Date.parse(fixture.date + 'T00:00:00+02:00');
  if (!Number.isFinite(epoch)) throw new Error('Invalid fixture date');
  return { opponent_name: fixture.opponentName.trim(), is_home_game: fixture.isHomeGame,
    round_number: fixture.roundNumber, season: fixture.season, game_date_epoch: epoch,
    created_at: createdAt, is_playoff: false, playoff_stage: null, playoff_game_number: null,
    quarter_length_sec: 600, quarters_count: 4, team_score: 0, opponent_score: 0,
    status: 'SCHEDULED', current_period: 1, clock_sec_remaining: 600,
    is_clock_running: false, last_clock_started_at: null, is_deleted: false };
}
export async function importSchedule(db, fixtures) {
  if (new Set(fixtures.map(f => f.matchId)).size !== fixtures.length) throw new Error('Duplicate fixture');
  const records = fixtures.map(f => ({ values: fixtureValues(f), key: `easycoach:${f.season}:${f.matchId}` }));
  let inserted = 0;
  for (const { values, key } of records) {
    const result = await createRecord(db, 'games', values, key);
    if (result.created) inserted++;
  }
  return { inserted, preserved: fixtures.length - inserted };
}
