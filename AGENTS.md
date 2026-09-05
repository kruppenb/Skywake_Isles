# Repository workflow

The canonical GitHub repository is https://github.com/kruppenb/Skywake_Isles.

The user has authorized this completion workflow for changes in this repository:

1. Finish the requested changes and run the relevant checks. For gameplay,
   networking, or rendering changes, run `npm test` (use `npm.cmd test` in
   PowerShell if script execution policy blocks `npm`). Run `git diff --check`.
2. Review the diff, commit the completed work, and push it to the canonical
   GitHub repository's `main` branch. Preserve unrelated work and remote
   history; do not force-push. Do not leave finished changes only on this host.
3. Deploy the committed source to the local Docker Desktop service with
   `docker compose up -d --build --wait` from this directory. Preserve the
   `skywake-data` volume and other projects' containers.
4. Verify `docker compose ps`, `http://localhost:3400/health`, and that changed
   browser assets served by Docker match the committed source. The client
   directory is served at the URL root (for example, `/models.js`).
5. Report the commit, GitHub push, and Docker health. If a check, push, or
   deployment fails, fix it when possible and state any remaining blocker.

These commit, push, and local deployment steps are standing user instructions;
do not ask for routine confirmation again. Required tool/sandbox approvals
still apply. Never commit credentials, local saves, dependencies, or QA output.
