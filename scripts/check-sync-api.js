// Read-only deployment check. Does not connect to PostgreSQL or run migrations.
const base = new URL(process.argv[2] || 'https://basketball-tracker-api.onrender.com/');
if (!base.pathname.endsWith('/')) base.pathname += '/';
let supported = false;
for (const path of ['', 'sync/capabilities']) {
  const url = new URL(path, base);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    const result = { url: url.origin + url.pathname, status: response.status };
    if (path === 'sync/capabilities' && response.ok) {
      const body = await response.json();
      result.protocolVersion = body.protocolVersion;
      supported = Number.isInteger(body.protocolVersion) && body.protocolVersion >= 2;
    }
    console.log(JSON.stringify(result));
    if (!response.bodyUsed) await response.body?.cancel();
  } catch (error) {
    console.error(JSON.stringify({ url: url.origin + url.pathname, error: error.cause?.code || error.name }));
  }
}
if (!supported) {
  console.error('Sync protocol 2 is unavailable. Deploy the updated backend or check the Android API base URL.');
  process.exitCode = 1;
}
