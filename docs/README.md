# Project docs

These files are the source of truth for what the app should do and how far the build has got. Code follows the docs: if the two disagree, fix one of them in the same change.

## The files

| File | What it answers | When it changes |
| --- | --- | --- |
| [design-overview.md](design-overview.md) | How does the app work, in plain words? | When a phase changes how the app works or is built |
| [spec.md](spec.md) | What are we building? | When a requirement changes |
| [decisions.md](decisions.md) | Why is it this way? | When a decision is made or reversed |
| [progress.md](progress.md) | Where are we now? | Every time a task or phase changes status |
| [testing.md](testing.md) | How is it tested, and what should each phase add? | When a test layer or rule changes, and before each phase |
| [phases/](phases/) | What exactly is in each phase, and how do we know it is done? | Before a phase starts, and as its tasks are ticked off |
| [qa/](qa/) | What did a hands-on test run find? | After each QA run (reports by the `qa-tester` agent or a person) |
| [reviews/](reviews/) | What did a code review find? | After each review (reports by the `code-reviewer` agent or a person) |
| [tech/](tech/) | How is the code built? | When the structure changes (pages kept by the `tech-writer` agent) |

## The workflow

1. **Spec first.** A new feature or a change of behaviour is written into `spec.md` before any code. If it involved a choice, add a line to `decisions.md`.
2. **Plan the phase.** The phase file lists the tasks and the acceptance checks. Adjust it before starting, not after.
3. **Build.** Tick tasks in the phase file as they are finished.
4. **Verify.** Run `npm run test:all` (see [testing.md](testing.md)), then the acceptance checks in the real app. The `qa-tester` agent can run them in the browser preview first and explore beyond them; its report goes in [qa/](qa/). The `code-reviewer` agent reviews the code against the spec; its report goes in [reviews/](reviews/). A phase is Done only when every check passes.
5. **Update progress.** Change the phase's status in `progress.md` and note anything carried over.

## Status words

| Status | Meaning |
| --- | --- |
| Not started | No code yet |
| In progress | Being built |
| Built, not verified | Code is written; acceptance checks have not all passed in the real app |
| Done | Every acceptance check passed |

## Rules that keep this light

- One spec file. Split it only when it becomes hard to navigate.
- A decision is one row: date, decision, reason. No essays.
- A phase file is a checklist, not a design document. Design belongs in `spec.md`.
- Ideas that are out of scope go into the "Later" list in `progress.md`, so they are not lost and do not creep in.
