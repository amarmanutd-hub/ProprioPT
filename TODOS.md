# TODOS

## Pack / Distribution

### Pretty `/pack/knee-v1` URL

**What:** Add Vercel rewrite (and correct asset `BASE_URL` / back-link handling) so the pilot invite can be `/pack/knee-v1` instead of `/demo/?pack=knee-v1`.

**Why:** Cleaner SMS link for PTs; matches the original design-doc URL.

**Context:** Eng review (2026-07-18) deferred the rewrite after an outside-voice finding: `DEMO_BASE=/demo/` plus pathname detection made a naive `/pack/` rewrite easy to break (cues/CSS/back-link). Working query-param pack mode must ship first. Start from `website/vercel.json`, `pt-app/vite.config.ts` (`DEMO_BASE`), and pack-mode detection in `main.ts`. See eng plan: `~/.gstack/projects/proprio/amarmalhi-master-eng-plan-20260718-005346.md`.

**Effort:** S
**Priority:** P3
**Depends on:** Working `/demo/?pack=knee-v1` pilot path
**Status:** Implemented 2026-07-18 — rewrite + pathname pack detect + COOP/COEP on `/pack/`

## Completed

- Product-complete path T1–T7 (limits types, portal UI, pack launch, flexion enforce, pain stop, `/pack/` URL, heel-slide form)
- Form×5 hardening (2026-07-18): latch form events, multi-set+rest, bridge polarity, step-up front+valgus, heel incompleteFlex, standing side, audio gate, sims

## Backlog

### Kaia-style floor setup wizard

**What:** Optional phone-prop / distance / silhouette coaching before floor moves (Approach B from tracking-smooth design).
**Why:** Competitors invest heavily in setup UX; geometry+confidence ships first but first-time PT patients still may place the camera wrong.
**Context:** Deferred by plan-eng-review 2026-07-18. Implement after TrackConfidence + floor_diagonal + one-leg biomech. See `~/.gstack/projects/Proprio/amarmalhi-master-design-tracking-smooth-20260718-155444.md`.
**Effort:** M
**Priority:** P3
**Depends on:** Tracking smoothness floor-first PR

### Dedicated form cue WAVs

**What:** Record/add WAVs for bentKnee, incompleteLift, overFlexion, incompleteRise, incompleteFlex.
**Why:** CQ2 leaves most pack flags banner+haptic only.
**Effort:** M
**Priority:** P3
**Depends on:** Form×5 hardening shipped

### MediaPipe Heavy (or deeper silence) if instrument trips

**What:** After heel-identity Approach B ships, run `?debugTrack=1` overlap heel set. If ≥3 reps show knee visibility &lt; WEAK_MIN for ≥3 consecutive frames *before* a lock flip, open a follow-up design for PoseLandmarker Heavy and/or stronger silence — do not sneak into the identity PR.
**Why:** Association/ID often patches detector collapse under occlusion; instrument must decide, not vibes.
**Context:** Eng review 2026-07-19; design `amarmalhi-master-design-heel-identity-20260719-002710.md`; exit rule locked in eng plan.
**Effort:** M–L
**Priority:** P3
**Depends on:** Heel identity Approach B baked + founder overlap clip + debugTrack logs
