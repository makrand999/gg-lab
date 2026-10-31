# Teacher auto-draw robustness audit

The model returns a JSON object containing `commands` and `reply`. Each command
is a drawing DSL line, using exactly the same engine as the `.edc` CLI. There is
no JavaScript or shell evaluation. To replay an output, join its commands with
newlines and run `npm run edc -- drawing.edc`.

## Fixes

- Validate the complete plan on a detached entity table, then apply it as one
  undoable change. Any failed command preserves the current sheet and history.
- Keep an existing model draft until a replacement passes validation.
- Enforce teacher/academic access in the API and the browser bridge.
- Reject overlapping requests and discard responses after sheet edits, mode
  transitions (including edit → view → edit), or session changes. A hung model
  request times out after 120 seconds and releases the lock for retry.
- Reject malformed command arrays as a whole, forbidden page-control commands,
  overlong commands, oversized plans, and truncated model completions.
- Retry an invalid schema or failed command plan once, with its validation
  reason and the original question/context. Refusals do not retry; neither
  failed attempt can affect the sheet. Transient gateway failures also get
  one retry; missing credentials, expired sessions, and bad requests do not. The 120-second budget covers both calls.
- Provide existing point coordinates to the model instead of labels alone.
- Support 128 commands and an 8,192-token response budget so larger drawings
  are not silently truncated. Accept prompts plus hints up to 3,000 UTF-8 bytes.
- Teach signed first-angle projection coordinates and explicit view roles,
  including points on HP/VP and quadrants II–IV. Validate every matching
  projector pair, including Unicode primes and case aliases, while allowing
  independent profile-view coordinates.
- Bound hatching before entering its generation loop. Reject extreme numeric
  inputs, empty names, and incomplete quoted arguments. Validate all chain
  edges before creating them, preventing partially drawn collapsed chains.
- Preserve special point names such as `__proto__` in completion/context maps.
- Truncate model replies at UTF-8 character boundaries so JSON remains valid.
- Correct stale CSS paths in the login/studio/backend test fixtures and relative
  font/menu-image URLs after the existing move into `public/css/`.

## Reproducible checks

`npm run test:auto-draw` runs 17 regression groups, including a seeded matrix
of 2,000 malformed commands. `test:phase33` additionally tests the real C++ API
against a controllable gateway: authentication, request validation, malformed
model schemas, unsafe commands, completion truncation, Unicode, context, and
gateway/key failures.

`tools/test-auto-draw-browser.js` runs in T3 preview on a disposable guest sheet.
It mocks interpretation while exercising the mounted bridge, history, mode
switches, and teacher deep-link flow. All eight checks passed.

The opt-in live evaluation uses a disposable database/server and the configured
gateway credentials. It creates no question sets, saved drawings, or attached
model answers:

```sh
npm run build:cpp
EDUCAD_NL_MODEL=gemini-3.8-flash-high npm run test:auto-draw:live -- docs/AUTO_DRAW_MODEL_RESULTS.json
```

The report records every prompt case's generated command list, reply, timing,
and independently checked result. Coverage includes geometry commands,
quadrants I–IV, HP/VP boundary points, tilted lamina, inclined line, cube,
cylinder, cone, plate with holes, context reuse, Unicode, and refusals.

## Results

`gemini-3.8-flash-high`: all 23 scenarios have passing final per-case results.
The aggregate report combines 21 successes in the full matrix with the two
successful targeted reruns after gateway timeout/retry fixes; it does not
represent one uninterrupted clean run. The initial schema failure and later
upstream failures remain in the raw reports and each retried case's history.

The high model exceeded the former 30-second gateway read timeout on a complex
case. The server now permits 60 seconds per gateway read, and the browser has
one shared 120-second budget for both attempts. It retries `interpret_failed`
once, while missing keys, authentication errors, invalid requests, and honest
model refusals remain immediate failures.

All 17 auto-draw regression groups (including 2,000 malformed inputs), eight
mounted browser checks, phase33 API checks, and the 43 backend, 15 login, 18
studio, and 20 saves checks passed. Baseline and phases 1–47 plus spatial,
drafting, and drawing regression suites passed with phase7 excluded. The
latest full `npm test` is blocked by the concurrently added
`public/lib/educad-mobile.js`: phase7's source audit rejects its `dialog` string.
That mobile implementation was left intact.

## Limits

Command validation proves that a plan can execute within the supported drawing
language and that named plan/elevation pairs align. It cannot prove that an
arbitrary natural-language question has been answered correctly. Live tests
check specific numeric and structural requirements independently; a passing
run is a sample from a nondeterministic model, not universal correctness.
Teachers should review the draft before attaching it to a question.

The backend changes require restarting the running EduCAD server; the audit
tests use newly built disposable servers without changing the hosted process.
