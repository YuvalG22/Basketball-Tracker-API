// Run before accepting traffic. No rows are removed or merged.
export async function migrateSyncSchema(db, {lock = true} = {}) {
  if (lock) await db.query('SELECT pg_advisory_xact_lock(193754221)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS event_tombstones (sync_key text PRIMARY KEY, deleted_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE event_tombstones ADD COLUMN IF NOT EXISTS game_remote_id uuid;
    ALTER TABLE event_tombstones ADD COLUMN IF NOT EXISTS game_version bigint;
    ALTER TABLE games ADD COLUMN IF NOT EXISTS season text NOT NULL DEFAULT '25/26';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS action_group_id text;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS game_version bigint;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='events'::regclass AND conname='events_assist_player_fkey') THEN
        ALTER TABLE events ADD CONSTRAINT events_assist_player_fkey
          FOREIGN KEY (assisted_by_player_remote_id) REFERENCES players(id) NOT VALID;
      END IF;
    END $$;
    ${['games', 'players', 'events', 'roster'].map(table => `
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sync_key text;
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS server_version bigint NOT NULL DEFAULT 0;
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS client_revision bigint NOT NULL DEFAULT 0;
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS last_mutation_key text;
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS last_mutation_version bigint;
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS create_revision bigint NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX IF NOT EXISTS ${table}_sync_key_unique ON ${table}(sync_key);
    `).join('\n')}
    -- Device-local integers are not globally unique. The controller now identifies
    -- roster membership by remote game/player, including for older clients.
    ALTER TABLE roster DROP CONSTRAINT IF EXISTS roster_local_game_id_local_player_id_key;
    CREATE INDEX IF NOT EXISTS roster_remote_membership ON roster(game_remote_id, player_remote_id);
    CREATE INDEX IF NOT EXISTS events_game_time ON events(game_remote_id, period, clock_sec_remaining, created_at);
  `);
}
