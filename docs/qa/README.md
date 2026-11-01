# QA reports

Hands-on test runs of the app, written by the `qa-tester` agent (`.claude/agents/qa-tester.md`) or by a person. Each run is one file: `YYYY-MM-DD-<scope>.md`, with its screenshots in `shots/YYYY-MM-DD-<scope>/`.

A report is a record, not a to-do list. After reading one:

- A finding to fix → fix it the normal way (spec first if behaviour changes, a test for the bug).
- A suggestion worth doing → into `spec.md` (with a row in `decisions.md`) or the "Later" list in `progress.md`.
- An E2E gap → a row in `testing.md` section 4, then the test.
- An AC that passed → the phase file is ticked by whoever confirms it in the real app. "Preview only" is not enough on its own.

## Running it

In Claude Code, ask for the agent with a scope:

> Use the qa-tester agent on phase 5.
> Use the qa-tester agent on everything.
> Use the qa-tester agent, explore only: the chapter review flow.

It reads the phase files fresh each time, so new phases and changed acceptance checks are picked up without changing the agent. It drives the browser preview with `scripts/qa-step.mjs` and the mock AI server; it never uses a real API key.

## Template

```markdown
# QA: <scope>

**Date:** YYYY-MM-DD · **Tester:** qa-tester agent · **Build:** browser preview (npm run dev), mock AI
**Scope:** <phases / spec sections> · **Time spent:** <rough>

## Summary

<Three to five sentences: is it ready, what is the biggest risk, what was not covered.>

| Pass | Fail | Partial | Preview only | Not testable here |
| --- | --- | --- | --- | --- |
| n | n | n | n | n |

## Acceptance checks

| Phase · AC | Check (short) | Spec | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 5 · 1 | Budget Lean → Rich changes request size | 6.2 | Pass | `_last-request` sizes 4.1k vs 9.8k chars |

## Findings

### QA-01 · <Severity> · <Area> · <one-line title>

**Steps** (from a fresh profile, key `sk-test-...`):
1. …

**Expected:** … (spec §x.y / decision n)
**Actual:** …
**Evidence:** ![](shots/YYYY-MM-DD-<scope>/012-name.png)
**Likely cause** (optional): `src/...`

## Suggestions

| # | Suggestion | Helps | Why | Size | Spec change? |
| --- | --- | --- | --- | --- | --- |
| S-01 | … | New users | … | Small | No |

## E2E gaps

- <Flow that a test should guard, one line, like the testing.md table>

## Exploration log

<Short notes of the user journeys tried beyond the ACs and what happened, including the ones that went fine.>

## Not covered

<What was out of scope, blocked, or needs the real app or a person, and how to check it.>
```
