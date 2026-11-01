import pool from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function transaction(work, database = pool) {
  const db = await database.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* Preserve the original connection error. */ }
    throw error;
  } finally { db.release(); }
}

export const endpoint = work => async (req, res) => {
  try { res.json(await transaction(db => work(db, req), req.database || pool)); }
  catch (error) {
    console.error('API request failed:', error.code || error.name);
    res.status(error.status || (['22P02', '23502', '23503'].includes(error.code) ? 400 : 500))
      .json({ error: error.status ? error.message : 'Request could not be saved' });
  }
};

const response = row => ({ remoteId: row.id, serverVersion: Number(row.server_version),
  clientRevision: Number(row.client_revision), isDeleted: row.is_deleted });
const creationResponse = row => ({...response(row),serverVersion:0,clientRevision:Number(row.create_revision)});
const mutationResponse = row => ({...response(row),serverVersion:Number(row.last_mutation_version??row.server_version)});

// Tables/columns are supplied only by our controllers, never by request data.
export async function createRecord(db, table, values, key, revision = 0) {
  if (key != null && (typeof key !== 'string' || key.length > 200)) throw new HttpError(400, 'Invalid sync key');
  if (key) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${table}:${key}`]);
    const existing = await db.query(`SELECT * FROM ${table} WHERE sync_key=$1`, [key]);
    if (existing.rows.length) return Object.defineProperty(creationResponse(existing.rows[0]), 'created', {value:false});
  }
  const data = { ...values, sync_key: key || null, client_revision: revision, create_revision: revision };
  if (table === 'events' && key) {
    const deleted = await db.query('SELECT 1 FROM event_tombstones WHERE sync_key=$1', [key]);
    if (deleted.rows.length) data.is_deleted = true;
  }
  const columns = Object.keys(data);
  const inserted = await db.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES
    (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(data));
  return Object.defineProperty(creationResponse(inserted.rows[0]), 'created', {value:true});
}

export async function updateRecord(db, table, id, values, body) {
  const result = await db.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
  const old = result.rows[0];
  if (!old) throw new HttpError(404, 'Record not found');
  if (old.is_deleted) throw new HttpError(409, 'Record was deleted on the server');
  if (body.mutationKey && old.last_mutation_key === body.mutationKey) return mutationResponse(old);
  if (body.expectedServerVersion != null && Number(body.expectedServerVersion) !== Number(old.server_version))
    throw new HttpError(409, 'Record changed on another device. Local changes were kept.');
  const data = { ...values, client_revision: body.clientRevision ?? 0, last_mutation_key: body.mutationKey || null };
  const updated = await db.query(`UPDATE ${table} SET ${Object.keys(data).map((c, i) => `${c}=$${i + 2}`).join(',')},
    last_mutation_version=server_version+1, server_version=server_version+1 WHERE id=$1 RETURNING *`, [id, ...Object.values(data)]);
  return mutationResponse(updated.rows[0]);
}

export const mutationAcknowledgements = endpoint(async (db, req) => {
  if (!Array.isArray(req.body) || req.body.length > 100) throw new HttpError(400, 'Invalid acknowledgement query');
  const results = [];
  for (const item of req.body) {
    if (!['games','players'].includes(item.table)) throw new HttpError(400, 'Invalid record type');
    const found = await db.query(`SELECT id AS "remoteId",last_mutation_key AS "mutationKey",
      last_mutation_version AS "serverVersion",client_revision AS "clientRevision"
      FROM ${item.table} WHERE id=$1 AND last_mutation_key=$2 AND NOT is_deleted`, [item.remoteId,item.mutationKey]);
    if (found.rows.length) results.push({...found.rows[0],table:item.table});
  }
  return results;
});

export async function requireGame(db, id, expectedVersion = null) {
  // Serialize events/roster/game deletion so children cannot arrive after deletion.
  const result = await db.query('SELECT * FROM games WHERE id=$1 FOR UPDATE', [id]);
  if (!result.rows[0] || result.rows[0].is_deleted) throw new HttpError(409, 'Game unavailable or deleted');
  if (expectedVersion != null && Number(expectedVersion) !== Number(result.rows[0].server_version))
    throw new HttpError(409, 'Game changed on another device. Local actions were kept.');
}

export async function refreshScore(db, gameId) {
  await db.query(`UPDATE games SET
    team_score=s.team, opponent_score=s.opponent
    FROM (SELECT COALESCE(SUM(CASE type WHEN 'TWO_MADE' THEN 2 WHEN 'THREE_MADE' THEN 3 WHEN 'FT_MADE' THEN 1 ELSE 0 END),0) AS team,
      COALESCE(SUM(CASE type WHEN 'OPP_TWO_MADE' THEN 2 WHEN 'OPP_THREE_MADE' THEN 3 WHEN 'OPP_FT_MADE' THEN 1 ELSE 0 END),0) AS opponent
      FROM events WHERE game_remote_id=$1 AND is_deleted=false) s
    WHERE games.id=$1`, [gameId]);
}

export async function preserveRecordedScore(db, gameId) {
  const recorded = await db.query(`SELECT 1 FROM events WHERE game_remote_id=$1
    AND type IN ('TWO_MADE','THREE_MADE','FT_MADE','OPP_TWO_MADE','OPP_THREE_MADE','OPP_FT_MADE') LIMIT 1`, [gameId]);
  if (recorded.rows.length) await refreshScore(db, gameId);
}

export function validateRevision(body) {
  if (body.clientRevision != null && (!Number.isSafeInteger(body.clientRevision) || body.clientRevision < 0))
    throw new HttpError(400, 'Invalid client revision');
}
