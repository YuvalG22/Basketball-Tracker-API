# 26/27 schedule import

Deploy the backend status support first, then run `npm run import:schedule` from this directory with the normal DATABASE_URL configured. This explicitly connects to the configured database; the app does not import automatically. The command migrates status checks and imports all nine fixtures in one transaction. Reruns preserve existing fixtures, including started, finished and deleted games.

After import, use Sync on Android to download the schedule. The website Games tab loads fixtures from the same database. No EasyCoach connection is needed. Fixture dates are midnight Asia/Jerusalem; the bundled dates all fall in standard time (+02:00).

The import command has not been run as part of this implementation.
