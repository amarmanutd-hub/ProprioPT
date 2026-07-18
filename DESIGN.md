# Design System — Proprio

## Product Context
- **What this is:** Browser-based home exercise form coach. PT assigns exercises/dosing; patient enters a code (no account); live cues where form is coached; session summary stays on-device.
- **Who it's for:** Physical therapists (prescribers) and their HEP patients (camera users).
- **Space/industry:** Digital MSK / HEP (MedBridge GO, Physitrack, employer MSK apps). Differentiator is **live form**, not another video library.
- **Project type:** Hybrid — marketing site (`website/`), PT portal + code activate (`portal/`), pack coach (`pt-app/`).
- **Memorable reaction:** “Wow — this would be the best thing.” Wow lives in the **session** (body + coach), not in invite chrome.

## Aesthetic Direction
- **Direction:** Clinical calm + craft confidence
- **Decoration level:** Intentional (soft depth, pose silhouette as hero; no decorative blobs, no purple gradients)
- **Mood:** Quiet trust for PTs; premium craft when the patient is moving. Familiar code entry; unforgettable form coaching.
- **Reference posture:** MedBridge-style *distribution* (code, no patient account). Proprio-owned *session* (camera stage, plain-language cues, honest “form coached” vs “counting only”).

## Typography
- **Display/Hero:** Fraunces — brand, coach lines, large reps
- **Body / UI:** Source Sans 3 — status, buttons, setup copy
- **Data/Tables:** Fraunces with `font-variant-numeric: tabular-nums` for reps and angles
- **Code:** not primary; use Source Sans 3 mono only if needed for codes (`PROP-####`)
- **Loading:** Google Fonts (Fraunces opsz + Source Sans 3 400–700)
- **Scale (approx):**
  - Brand mark: clamp(3rem, 12vw, 5.5rem)
  - Section H2: clamp(1.75rem, 3.5vw, 2.5rem)
  - Coach line: clamp(1.2rem, 3.2vw, 1.65rem)
  - Body: 1–1.1rem
  - Meta / chip: 0.75–0.85rem
  - Rep counter: clamp(2.75rem, 9vw, 4.25rem)

## Color
- **Approach:** Restrained (one accent family + neutrals; semantic colors rare)
- **Ink:** `#0c1418` — primary dark surface / text on paper
- **Ink soft:** `#1a2a32`
- **Paper:** `#f2f6f7` — light surfaces, primary CTAs on dark heroes
- **Mist:** `#d7e2e6`
- **Sea (primary):** `#2f7a86` — actions, progress “on”
- **Sea deep:** `#1a4f59` — emphasis text, hover
- **Moss:** `#3d7a5a` — success / completed progress
- **Amber:** `#9a6b16` — warn / “counting only”
- **Coral:** `#a33b2e` — form violations / errors (not routine status)
- **Dark mode:** Marketing + pack stage are dark-first; sheets/results use paper on glass. Do not invert coral for routine chrome.

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable (rehab + phone-on-floor; large targets)
- **Scale:** 2xs 2 · xs 4 · sm 8 · md 16 · lg 24 · xl 32 · 2xl 48 · 3xl 64
- **Touch:** Primary controls min-height ~44–48px

## Layout
- **Approach:** Hybrid — poster/composition-first marketing; one-job sheets in pack/activate
- **Hero budget:** Brand (Proprio) dominant, one headline, one lede, one CTA group, one visual (pose/camera plane). No cards in hero. No stat strip in first viewport.
- **Below fold:** Stats / credibility OK for PT landing
- **Pack:** Quiet chrome, loud coach; 5-step pack progress; mode chip visible
- **Max content width:** ~36–40rem for prose; pack UI full-bleed stage
- **Border radius:** sm 8px · md 10px · lg 12px · sheet/dialog ~12–18px. Prefer 10px buttons over pill (`999px`) clusters.

## Motion
- **Approach:** Intentional (2–3 moments, not noise)
- **Moments:** Pose breathe / float-in; cue flash; results card rise; pack progress scaleY on active step
- **Easing:** `cubic-bezier(0.22, 1, 0.36, 1)`
- **Duration:** micro 50–100ms · short 150–250ms · medium 250–400ms · long 400–700ms
- **Respect:** `prefers-reduced-motion: reduce` → static pose, no count-up thrash, no breathe

## SAFE / RISK (locked)
**Safe:** Code-first patient entry; plain language; large primary action; privacy stated early; sourced stats for PTs.  
**Risks:** (1) Session-as-hero (2) Quiet chrome, loud coach (3) Honest form vs counting modes.

## Anti-patterns (do not ship)
- Purple/violet gradients, Inter/Roboto/Arial as primary, pill soup everywhere
- 3-column icon feature grids, centered SaaS everything
- Cards in the hero; dashboard chrome during a live set
- Overclaiming form coaching on stub/counting-only moves

## Surfaces
| Surface | Path | Role |
|---------|------|------|
| Marketing | `website/` | PT first impression + pack CTA |
| Activate | `portal/` `/activate` | Code entry, no password theater |
| Pack coach | `pt-app/` `?pack=knee-v1` | Wow moment — form + summary on screen |

## Preview
`~/.gstack/projects/proprio/designs/design-system-20260718/preview.html`

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-18 | Initial system via /design-consultation | Memorable “wow / best thing”; research showed HEP category = video+checkmarks; differentiate in session craft; keep Fraunces+sea |
| 2026-07-18 | Stats stay on landing (below fold) | Founder preference; PT credibility |
| 2026-07-18 | PT code model in narrative | MedBridge-familiar distribution; portal already has PROP codes |
