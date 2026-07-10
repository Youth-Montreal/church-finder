# Merge Review 2026-05-05

## Branch state

- Local branch: `main` at `4a596bd` (`HARD AI database connection fix`)
- Remote branch: `origin/main` at `1b56513`
- Divergence: local `main` is behind `origin/main` by 8 commits

## Remote-only changes to review and likely keep

These are already on GitHub and not yet in local `main`:

- `1b56513` Protect host registry from duplicate entries and auto-clean existing duplicates (#55)
- `8950bfb` Prevent duplicate hosts in admin workspace and sync
- `6379225` Update `PRIVACY_POLICY.md`
- `42f3c3a` Update `privacy-policy.html`
- `0166e87` Update `PRIVACY_POLICY.md`
- `47b0a91` Delete `.codex-temp` directory
- `f1d55b6` Add Google Play privacy policy and publishing guide (#54)
- `e445d2c` Add Google Play privacy policy and publishing guide

Files changed on `origin/main`:

- `.codex-temp/main.origin-main.js`
- `PRIVACY_POLICY.md`
- `README.md`
- `android/app/src/main/assets/src/controllers/adminController.js`
- `android/app/src/main/assets/src/i18n.js`
- `android/app/src/main/assets/src/main.js`
- `android/app/src/main/assets/src/utils/hostDedup.js`
- `privacy-policy.html`
- `src/controllers/adminController.js`
- `src/i18n.js`
- `src/main.js`
- `src/utils/hostDedup.js`

Recommendation:

- Keep these remote commits.
- Review the host de-duplication changes first because they are functional and may relate to the data consistency problems you mentioned.

## Local-only changes to review

These exist only in the current working tree:

- `AGENTS.md`
- `android/gradle.properties`
- `assets/icons/report.svg`
- `android/app/src/main/assets/assets/icons/report.svg` (staged new file)
- `android/app/release/app-release.aab`
- `android/.idea/deploymentTargetSelector.xml`
- `android/.idea/workspace.xml`
- `.codex-temp/main.origin-main.js` (deleted locally)

Recommendation by file:

- Keep `AGENTS.md`
  - This is project guidance and terminology clarification.
- Keep `android/gradle.properties` only if version bump `1.2.0` / code `6` is intentional for the next release.
- Keep `assets/icons/report.svg`
  - This changes the report icon color from `#BAC3CD` to `#8a2330`.
- Keep `android/app/src/main/assets/assets/icons/report.svg` only if the Android asset copy is required.
  - If this asset should mirror the web asset, verify whether it also needs to exist under the non-Android asset pipeline.
- Discard `android/.idea/deploymentTargetSelector.xml`
  - IDE-local metadata.
- Discard `android/.idea/workspace.xml`
  - IDE-local metadata with machine-specific state.
- Discard `android/app/release/app-release.aab` unless you explicitly want to version a newly built release artifact.
- Local deletion of `.codex-temp/main.origin-main.js` matches the direction of `origin/main`, which deletes `.codex-temp`.

## Overlap risk

There is no meaningful code-file overlap between local working-tree changes and the 8 remote commits.

The only overlap is `.codex-temp/main.origin-main.js`, where both sides move toward deletion.

This means the safest merge path is:

1. Preserve the local changes you want to keep.
2. Fast-forward local `main` to `origin/main`.
3. Re-apply only the pertinent local changes.

## Suggested keep/discard set

Keep:

- `AGENTS.md`
- `android/gradle.properties` if release bump is intentional
- `assets/icons/report.svg`
- `android/app/src/main/assets/assets/icons/report.svg` if needed by the packaged Android assets

Discard:

- `android/.idea/deploymentTargetSelector.xml`
- `android/.idea/workspace.xml`
- `android/app/release/app-release.aab`

## Useful comparison commands

```powershell
git log --oneline --left-right HEAD...origin/main
git diff --stat HEAD..origin/main
git diff --stat
git diff --cached --stat
```
