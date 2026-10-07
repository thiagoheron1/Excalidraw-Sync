# Project instructions

## Deletion interactions

- Every deletable user-created entry in a list must support a swipe to the left to request deletion on touch devices.
- Always show a confirmation dialog before deleting. Cancelling must leave the entry unchanged.
- Also provide an accessible delete control for keyboard and desktop users.
- A swipe alone must never permanently delete data.

## Regression tests for fixes

- Every reported issue that is reproduced and fixed must receive a focused automated regression test that simulates the original failure scenario.
- Follow this sequence: reproduce the failure, add the focused regression test, fix the root cause, confirm the regression test passes, then run the relevant existing tests.
- Keep the regression test in the permanent test suite so the same behavior cannot silently return.
- If an automated test is technically impossible, document why and record the closest repeatable verification evidence instead.
