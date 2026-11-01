import express from 'express';
import cors from 'cors';
import pool from './db.js';
import { endpoint, mutationAcknowledgements } from './syncStore.js';
import { getSnapshot } from './syncSnapshot.js';
import eventsRoutes from './routes/events.js';
import gamesRoutes from './routes/games.js';
import playersRoutes from './routes/players.js';
import rosterRoutes from './routes/roster.js';
import statsRoutes from './routes/stats.js';

export function createApp(database = pool) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use((req, res, next) => { req.database = database; next(); });
  app.get('/', (req, res) => res.send('Basketball backend is running'));
  app.get('/sync/capabilities', (req, res) => res.json({ protocolVersion: 2 }));
  app.get('/sync/snapshot', endpoint(db => getSnapshot(db)));
  app.post('/sync/mutation-acknowledgements', mutationAcknowledgements);
  app.use('/events', eventsRoutes);
  app.use('/games', gamesRoutes);
  app.use('/players', playersRoutes);
  app.use('/roster', rosterRoutes);
  app.use('/stats', statsRoutes);
  app.use('/home', gamesRoutes);
  app.use((error, req, res, next) => {
    console.error('API error:', error.code || error.name);
    res.status(error.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'Request failed' });
  });
  return app;
}
