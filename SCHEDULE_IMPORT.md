# 26/27 schedule import

Deploy the backend status support first, then run `npm run import:schedule` from this directory with the normal DATABASE_URL configured. This explicitly connects to the configured database; the app does not import automatically. The command migrates status checks and imports all nine fixtures in one transaction. Reruns preserve existing fixtures, including started, finished and deleted games.

To apply the updated schedule to existing fixtures, run `npm run import:schedule -- --update-scheduled`. Only scheduled, non-deleted games with no recorded events have their dates/times updated. Their IDs, scores, rosters, and other game state are preserved. Changed rows receive a new server version for Android sync. Repeating the command does not change already matching rows.

After import, use Sync on Android to download the schedule. The website Games tab loads fixtures from the same database. No EasyCoach connection is needed. The bundled schedule was updated from the November 22, 2026 matches export: known start times use Asia/Jerusalem standard time (+02:00); rounds 4 (December 17) and 5 (December 24) were subsequently confirmed as 21:00. The web hides midnight placeholders.
