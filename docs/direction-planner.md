# Scene direction planner

The desktop action handler now interprets the full request before compiling any motion.
Candidate clause boundaries are conjunctions and punctuation, not a verb list. A typed
Jev/Laya choice labels each candidate as a continuation, sequential action, simultaneous
action, or framing constraint. Explicit temporal connectors and continuous framing
phrases have deterministic guards. The underlying movement catalogue is still finite.

The planner resolves action families and movement decisions first, reserves time for all
sequential groups, and compiles each group against the resulting scene state. Inferred
durations shrink proportionally when necessary. Explicit durations that cannot fit cause
an error before anything is applied. Simultaneous actions compose transform deltas.

Direction plans persist in the project with action IDs, source text, timing, references,
constraints and decision responses. The composer exposes a collapsed Regia list. Clicking
an action edits it; unchanged action decisions are reused and the sequence is recompiled
with stable action IDs. Undo includes both the metadata and generated keyframes.

Continuous camera framing targets the reference object's origin. It generates visible
rotation keyframes, simplifies them to 0.05-degree Euler interpolation error, and checks
alignment at every integer frame, including after merging the sequence. This is not a
whole-body bounding-box, occlusion, or lens-fit solver. Conflicting pan/tilt and centered
framing requests fail rather than silently overriding one another. Radial movement is
checked against the reference's actual distance.

## Validation on 2026-09-23

- 196 automated tests passed, including full approach/retreat compilation, insufficient
  duration, reference persistence, save/undo, and editing only the second action.
- TypeScript and renderer/desktop builds passed.
- Real local Laya, two requests, model already cached:
  - `la camera si avvicina e poi si allontana dal personaggio`: passed, 18.628 s.
  - `la camera si avvicina al personaggio e poi si allontana, continuando a inquadrarlo`:
    passed, 18.909 s.
- The first live run misclassified continuous framing as another action; the deterministic
  constraint guard fixes that case and has a regression test.
- These two cases are smoke tests, not a broad language accuracy benchmark. Jev online was
  not exercised in this validation. Scripts/evaluate-direction.ts runs the local Laya cases.
