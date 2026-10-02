# docs/phase-1

The record of Phase 1 of Yap, "the generator": the part that turns `/yap how <feature> works` into verified,
narrated, rendered chapter videos. Read `SUMMARY.md` first; it explains every term.

- `SUMMARY.md`: the roll-up. What was built (the eight `yap` commands, the skill's steps, the exact files a
  chapter folder holds and what each guarantees), the measured results against the plan's goals, which test
  pins each Review Focus item, how the work was done, what is still weak, proposed spec amendments awaiting
  the owner's approval, and what Phase 2 can rely on.
- `ACCEPTANCE.md`: the raw evidence. Three real runs on the `fixtures/todo-app` repository with real speech,
  word timing and renders: the first acceptance run, the re-run after the first fix wave, and the verification
  run of the R1 and R2 fixes. Every number in `SUMMARY.md` comes from here, with findings F1 to F15, R1 to
  R6 and V1 to V2.
- `frames/`: still frames from the first run's five chapters, six per chapter at 0, 10, 30, 50, 70 and 95 per
  cent (`<id>-<n>.png`, 960 wide) plus one 3x2 contact sheet per chapter (`<id>-sheet.png`), for judging layout
  and house style by eye.
- `frames-rerun/`: the same for the four chapters of the re-run after the fix wave (no wrapped code lines).

The mp4s themselves are not committed (`*.mp4` is git-ignored); the kept run folders are listed in
`ACCEPTANCE.md`.
