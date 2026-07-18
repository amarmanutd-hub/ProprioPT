# TODOS

## Pack / Distribution

### Pretty `/pack/knee-v1` URL

**What:** Add Vercel rewrite (and correct asset `BASE_URL` / back-link handling) so the pilot invite can be `/pack/knee-v1` instead of `/demo/?pack=knee-v1`.

**Why:** Cleaner SMS link for PTs; matches the original design-doc URL.

**Context:** Eng review (2026-07-18) deferred the rewrite after an outside-voice finding: `DEMO_BASE=/demo/` plus pathname detection made a naive `/pack/` rewrite easy to break (cues/CSS/back-link). Working query-param pack mode must ship first. Start from `website/vercel.json`, `pt-app/vite.config.ts` (`DEMO_BASE`), and pack-mode detection in `main.ts`. See eng plan: `~/.gstack/projects/proprio/amarmalhi-master-eng-plan-20260718-005346.md`.

**Effort:** S
**Priority:** P3
**Depends on:** Working `/demo/?pack=knee-v1` pilot path

## Completed
