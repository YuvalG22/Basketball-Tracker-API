import { createApp } from './app.js';
import { transaction } from './syncStore.js';
import { migrateSyncSchema } from './syncSchema.js';

await transaction(db => migrateSyncSchema(db));
const port = process.env.PORT || 3000;
createApp().listen(port, () => console.log("Server running on port " + port));
