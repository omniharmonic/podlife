<!--
Thank you for contributing to Pod Life. Fill in this template, then mark the
PR ready for review. Privacy-sensitive changes need an additional reviewer
with the `privacy` label.
-->

## Summary

<!-- One or two sentences. What does this change and why? -->

## Task reference

<!-- Reference the implementation plan task ID (e.g., P2.1, P4.3.7). -->

Closes/relates to: P_._

## Changes

<!-- Bullet list of notable changes. Keep it short. -->

-
-

## Test plan

<!-- How did you verify this works? Manual steps + automated tests. -->

- [ ]
- [ ]

## Definition of Done checklist

- [ ] Code follows the conventions in CONTRIBUTING.md (TS strict, no `any`,
      Zod for input validation, no default exports for non-component code).
- [ ] Unit tests added/updated for changed logic.
- [ ] Integration tests added/updated for new or changed API routes.
- [ ] If this touches privacy-sensitive code, the relevant privacy boundary
      test passes (and a new one is added if a new boundary was introduced).
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] No new lint warnings.
- [ ] Commit message references the task ID.
- [ ] Documentation updated (README, SELF_HOSTING, CHANGELOG, or inline comments) if user-facing.

## Privacy review

<!-- Required for any change that touches relationships, schedules, calendars, or outbound messages. -->

- [ ] N/A — this change doesn't touch privacy-sensitive code.
- [ ] If Person B called this endpoint / saw this message / received this
      notification, would they learn anything about Person C in a different
      pod? **Answer:** _no, because..._

## Screenshots / recordings

<!-- For UI changes. Drag and drop into the comment box. Redact any real personal data. -->

## Notes for reviewers

<!-- Anything you want reviewers to focus on. Tradeoffs, alternatives considered, follow-ups. -->
