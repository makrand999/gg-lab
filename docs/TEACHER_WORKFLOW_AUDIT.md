# Teacher workflow audit

Validated on 2026-10-07. The existing compact Codeforces-style layout, colors,
typography, text actions and grey separators are retained.

## Workflow improvements

- Existing classes and sets appear before creation forms. Text shortcuts jump to
  each section; class pages offer “Post a set here” and code copying.
- Question-set drafts retain metadata, class, questions, model references,
  pending text and pending edits through navigation and reloads in the same tab.
  Session storage is scoped to the teacher's username and role. Closing the tab
  ends this recovery; this is not a server-side draft service.
- Draft questions can be edited, reordered and removed. Posting requires
  finishing pending question edits, imports and prompt text first.
- Creating a set opens that set for model review and attachment.
- On the drawing sheet, successful auto-draw offers “Attach model to Q…” for
  the intended set/question. The teacher reviews the drawing and explicitly
  attaches it. Studio returns to that set. Reviewing another question from the
  Sets panel updates the contextual destination.
- Submissions have All / Needs grading / Auto-check failed filters and live
  counts. Saving a grade updates its row without resetting other grading forms.
  Model attachment, clearing and toggles also preserve grading forms.
- Form labels are associated with fields, keyboard focus is visible, action
  rows wrap, and status messages remain visible when scrolling.

## Bugs and edge cases addressed

- Failed, slow or missing class selection cannot silently post a draft as an
  open set. The sheet's separate creation form explicitly labels open access
  and links to Studio for class-scoped creation.
- Pending writes disable the affected controls, preventing duplicate requests
  and changes to an in-flight draft. Controls recover after failure, including
  drawing lists that finish loading while another request is pending.
- Delayed reads cannot insert an old set/class into another route or report an
  old error there. Navigating away during saved-model lookup cancels attachment
  before the model mutation.
- Codes, the 50-question limit and backend UTF-8 byte limits are checked before
  sending, preserving oversized prompts/hints/titles/remarks for correction.
- Bulk input and TXT/JSON uploads validate the entire batch before adding it.
  Invalid rows are not silently discarded. CSV is no longer advertised as
  supported when it has no CSV parser. File size, read failure and same-file
  retry are handled. Bulk questions do not silently inherit one model answer.
- Empty models are refused. Replacements require confirmation. Repeated model
  references in a new set resolve once per drawing. Attaching a model preserves
  the latest 3D-sharing choice, including a toggle made immediately beforehand.
- Reviewed-model attachment checks the session again after loading the latest
  question. Inspection mode cannot use the write action. A failed attachment
  keeps the drawing and permits retry.
- Malformed URI hashes recover to the studio with a readable error.

## Verification

Results are recorded in [TEACHER_WORKFLOW_BROWSER_RESULTS.json](TEACHER_WORKFLOW_BROWSER_RESULTS.json).

- 22 studio browser scenarios passed in the real teacher UI with in-memory
  account/data fixtures and injected request delays/failures.
- 9 drawing-sheet review/attachment scenarios passed on a disposable guest
  canvas with teacher/API overrides. Auto-draw used the mounted drawing bridge
  and a deterministic command plan; no model/provider request was required.
- An actual reload restored metadata, selected class, pending prompt and hint.
- Desktop 1280px, phone 390px and narrow 320px checks found no horizontal overflow.
- Full `npm test` passed against the current workspace.
- Additional lab (18), login (15), saves (20), model/grading (18), natural-language
  flow (16) and 3D-reference (13) regression groups passed.

Browser tests did not modify real classes, sets or submissions. These changes
are frontend changes and do not require a backend restart.

## Reproduce the browser checks

1. Run `node tools/prepare-teacher-preview.js`.
2. Open the app's `_teacher-audit.html` in T3's collaborative preview. Evaluate
   the trimmed contents of `tools/test-teacher-browser.js` with `awaitPromise`.
3. Open a disposable guest `index.html?draw=1` sheet. Evaluate the trimmed
   contents of `tools/test-teacher-model-browser.js` with `awaitPromise`.
4. Run `node tools/prepare-teacher-preview.js --clean` to remove the temporary
   served fixture. Keep the generator and test scripts for future audits.
