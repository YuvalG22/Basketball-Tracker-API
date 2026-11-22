// Shared by the explicit import command and offline tests. No automatic fixture import.
import { readFile } from "node:fs/promises";
import { createRecord } from "./syncStore.js";
export async function loadSchedule() {
  return JSON.parse(
    await readFile(
      new URL("../data/schedule-26-27.json", import.meta.url),
      "utf8",
    ),
  );
}
export function fixtureValues(fixture, createdAt = Date.now()) {
  if (
    !fixture.matchId ||
    fixture.season !== "26/27" ||
    !fixture.opponentName?.trim() ||
    typeof fixture.isHomeGame !== "boolean" ||
    !Number.isInteger(fixture.roundNumber) ||
    fixture.roundNumber < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fixture.date)
  )
    throw new Error("Invalid fixture");
  const time = fixture.time ?? "00:00:00";
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time))
    throw new Error("Invalid fixture time");
  // This season's fixtures run November 27 through March 19, before daylight saving.
  const epoch = Date.parse(`${fixture.date}T${time}+02:00`);
  if (!Number.isFinite(epoch)) throw new Error("Invalid fixture date");
  return {
    opponent_name: fixture.opponentName.trim(),
    is_home_game: fixture.isHomeGame,
    round_number: fixture.roundNumber,
    season: fixture.season,
    game_date_epoch: epoch,
    created_at: createdAt,
    is_playoff: false,
    playoff_stage: null,
    playoff_game_number: null,
    quarter_length_sec: 600,
    quarters_count: 4,
    team_score: 0,
    opponent_score: 0,
    status: "SCHEDULED",
    current_period: 1,
    clock_sec_remaining: 600,
    is_clock_running: false,
    last_clock_started_at: null,
    is_deleted: false,
  };
}
export async function importSchedule(
  db,
  fixtures,
  { updateScheduled = false } = {},
) {
  if (new Set(fixtures.map((f) => f.matchId)).size !== fixtures.length)
    throw new Error("Duplicate fixture");
  const records = fixtures.map((f) => ({
    values: fixtureValues(f),
    key: `easycoach:${f.season}:${f.matchId}`,
  }));
  let inserted = 0,
    updated = 0;
  for (const { values, key } of records) {
    const result = await createRecord(db, "games", values, key);
    if (result.created) inserted++;
    else if (updateScheduled) {
      const changed = await db.query(
        `UPDATE games SET game_date_epoch=$2, server_version=server_version+1
        WHERE sync_key=$1 AND status='SCHEDULED' AND NOT is_deleted
          AND game_date_epoch IS DISTINCT FROM $2
          AND NOT EXISTS (SELECT 1 FROM events WHERE game_remote_id=games.id)
        RETURNING id`,
        [key, values.game_date_epoch],
      );
      updated += changed.rows.length;
    }
  }
  return updateScheduled
    ? { inserted, updated, preserved: fixtures.length - inserted - updated }
    : { inserted, preserved: fixtures.length - inserted };
}
