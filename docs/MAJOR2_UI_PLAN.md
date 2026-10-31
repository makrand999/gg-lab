# EduCAD Major 2 — interface redesign plan

Status: initial implementation delivered with Warm Studio and all six theme options.
See [MAJOR2_UI.md](MAJOR2_UI.md) for implemented workflows, setup, and remaining extensions.
Target: `mitasia.in/major2/`, alongside the current `/major/` application.
Audience: students and teachers, including people using CAD or a computer for the first time.

## 1. The direction

Make EduCAD feel like a friendly learning workspace: readable, spacious, tactile,
and guided. A newcomer should recognize the next useful action without knowing
CAD shortcuts or reading the full manual. Experienced users should still be able
to draw accurately and work quickly.

The change must cover layout, wording, interaction, and feedback. Recoloring the
current screens will not deliver this brief. The initial preview has been
replaced by an independent application and native drawing desk following this
specification.

Recommended identity: **Warm Studio** — ivory surroundings, clean white drawing
paper, terracotta buttons, dark readable text, and restrained geometric artwork.
Use precise engineering diagrams as the visual identity, with a warm human tone.

### What changes from the current interface

| Current pattern observed in the code | Major 2 direction |
|---|---|
| Codeforces-inspired 980 px pages with small link actions | Responsive application shell with large named actions |
| Most account controls are 11–13 px | Body text 16–18 px; secondary information usually 14 px |
| Buttons deliberately resemble plain links | Visible buttons with clear boundaries and hierarchy |
| Classes, forms, assignments, and results share a long page | Dedicated screens organized around a task |
| Drawing actions are spread across canvas corners | Stable drawing toolbar, task panel, and save area |
| Labels such as Sheet, Sets, Edit, View, and Pose | Drawing, Assignments, Draw, Inspect, and Move model |
| Shortcuts and modifier gestures are prominent in advanced work | Clickable tools and visible instructions; shortcuts are optional |
| Long manual sections explain interaction | Short help appears beside the current task; full reference stays available |
| Sparse visual hierarchy | Distinct page title, current task, next action, and supporting information |

These are observations about the current implementation, not findings from a user
study. Validate the proposed changes with novice users before treating them as proven.

## 2. Rules for making it approachable

1. **One main decision at a time.** Each task screen has one visually dominant
   action: Join class, Start question, Save drawing, or Submit drawing.
2. **Recognizable words.** Use short sentences and concrete verbs. Explain technical
   terms beside their first use, then retain their proper names in the reference.
3. **Icons always have labels for core actions.** A newcomer should not need to
   guess that a curved arrow means Undo or a cube means a 3D model.
4. **Show the next step.** Drawing a line says “Choose the first point,” then
   “Choose the second point.” A form says what is missing next to the field.
5. **Make recovery visible.** Undo stays available. Deletion has a separate,
   clearly worded confirmation when the backend cannot undo it.
6. **Reveal complexity gradually.** Common tools are visible; construction helpers,
   command entry, and uncommon line styles live under More tools or Advanced.
7. **Use comfortable defaults.** Open the useful drawing view, choose sensible
   display preferences, and offer a visible Fit drawing button.
8. **Respect the learner.** Use an adult, welcoming design. No babyish mascots,
   mocking error messages, or assumption that rural users have low literacy.
9. **Support weak connections.** Keep loaded work available while a request fails,
   show explicit save status, and offer Retry without discarding the form.
10. **Teach at the point of need.** A short example or diagram is preferable to a
    compulsory tour before the user can start.

Simple English is the initial copy direction. Keep labels in a translation
dictionary so Hindi or the institution's regional language can be added after
the actual audience language is established. Mathematical labels and units
remain accurate in every language.

## 3. Information architecture and navigation

Use the same shell on account pages, adapted to the signed-in role.

| Role | Main navigation | Primary home action |
|---|---|---|
| Student | Home · My classes · My drawings · Learn | Continue an assignment, or Join a class when new |
| Teacher / Academics | Home · My classes · Assignments · Review work | Review work waiting for feedback, or Create a class when new |
| Guest | Start drawing · Learn | Try a short practice drawing |

Keep Help, appearance, and account controls in a consistent secondary area.
Sign out belongs in the account menu, away from Save and Submit. Retain the
existing Academics role and permissions; the redesign does not invent new
administration capabilities.

On wide screens use a roughly 224 px sidebar with text labels. On small screens
use a labeled bottom navigation with at most four main destinations. Drawing
uses its own focused workspace, with a clear Back to assignment or Back to my
drawings action, rather than keeping a large account sidebar beside the canvas.

Proposed routes within the `/major2/` mount:

| Route | Purpose |
|---|---|
| `#/welcome`, `#/login` | Role selection and sign-in |
| `#/home` | Role-specific overview |
| `#/classes`, `#/classes/:code` | Join, create, and open a class |
| `#/assignments/:code` | Assignment and question overview |
| `#/assignments/new` | Teacher's assignment builder |
| `#/drawings`, `#/drawings/:id` | Saved drawings and workspace |
| `#/solve/:code/:question` | Student drawing for a specific question |
| `#/review/:submissionId` | Teacher's read-only review and feedback |
| `#/learn`, `#/learn/:lessonId` | Guided practice |

Hash routing is a practical first release choice: refreshing a screen still loads
the Major 2 entry page, and API calls can resolve against the stable mount root.
Keep existing drawing identifiers, class codes, and zero-based API question
indices compatible; display question numbers starting at 1 to users.

## 4. Screen-by-screen design

### 4.1 Welcome and login

The first screen asks **“What would you like to do?”** and offers three large
cards: “I'm a student,” “I'm a teacher,” and “Try without signing in.” Each card
contains one sentence explaining what is available. Put Academics access in a
clearly labeled secondary action rather than making it the novice's default role.

After role selection show a single-column form with persistent Username and
Password labels, a Show password control, and one Sign in button. Retain the
selected role and typed username after errors. Distinguish wrong credentials
from a network failure. Present demo credentials only in the demo deployment.

Do not add registration, password recovery, Google login, or OTP controls until
the backend supports those flows. Guests see “Practice drawings are not saved to
an account” before starting and have a clear route back to sign-in.

### 4.2 Student home

Use the heading **“What would you like to work on?”** rather than a decorative
marketing hero. The first useful card is either Continue drawing or Join your
class. Show real class and assignment information below it, with two or three
supporting cards at most: My drawings, Guided practice, and Help getting started.

An assignment card contains its title, class, number of questions, truthful
submission/review status, and one Start or Continue button. Show a due date,
percentage, or duration only when supported by real data. The present backend
does not provide assignment deadlines.

Empty state: **“Your teacher will give you a class code. Enter it to see your
assignments.”** Offer Join a class and Try a practice drawing. Avoid an empty
dashboard full of zero counters.

### 4.3 Join a class

A short dedicated screen contains a large class-code field, a visible Paste
action where clipboard permissions permit it, and Join class. Explain “Ask your
teacher for this code.” Preserve valid dashes and spelling, trim surrounding
spaces, and do not silently transform case if backend matching is case-sensitive.

After success show the actual returned class title and an Open class button.
For an invalid code show “We couldn't find this class. Check the code with your
teacher.” If the student has already joined, offer Open class without implying
an error. Do not add QR joining until it is implemented and tested separately.

### 4.4 Assignment and question overview

Show the assignment title, class, a short introduction, and a vertical list of
questions. Each row has a question number, readable prompt summary, status, and
one action. Opening a question shows its full prompt, any available hint, and a
Start drawing button. If the teacher enabled a 3D reference, put it beside the
prompt with explicit Rotate and Reset view controls.

Use distinct statuses for Not submitted, Submitted, and Teacher reviewed.
Automatic checks and teacher verdicts are separate: an automatic match is not
proof that the teacher has graded the work. Do not infer an unsaved draft from
a previous submission; show Continue only when a recoverable drawing exists.

### 4.5 Drawing workspace — the main redesign

Use a focused workspace with three stable areas on a large screen:

```text
┌ Back to assignment │ Question 2: Projection of a line │ Save │ Help ┐
├ Point · Line · Circle · Measure · More tools │ Undo │ Redo │ Fit ┤
│                                                   │ Question      │
│                 DRAWING PAPER                     │ Step / hint   │
│       Front view (VP)                             │ Properties    │
│       ───────────── XY ─────────────              │ 3D preview    │
│       Top view (HP)                               │               │
├ Choose the second point. │ Cancel │ Draw / Inspect / Move model ┤
└                                           Check │ Submit drawing ┘
```

The diagram is a layout proposal, not an exact rendering of a model. Engineering
views follow the current first-angle Monge contract.

**Header:** task title, explicit return destination, Save, and Help. Show Unsaved
changes → Saving → Saved only as actual state changes occur. The initial release
uses the current explicit Save operation. Autosave is a later opt-in enhancement
after concurrency and recovery handling are designed.

**Toolbar:** named tools for Point, Line, Circle, Measure, and More tools. Undo,
Redo, and Fit are always visible. A selected tool has an active border and label,
not just a different color. Advanced tools retain their actual engine behavior.

**Paper:** neutral white or ivory, dark technical ink, readable point labels,
and an optional faint grid. Keep the XY line and plane labels meaningful. Do not
put gradients, decorative geometry, glass effects, or large instructions over
the drawing. Move help to the surrounding interface.

**Task panel:** question at the top; current tool instructions or selected object
properties next; resizable 3D preview below. Allow the panel to collapse. Use a
tab switch if the viewport cannot accommodate all three sections.

**Guided drawing:** choosing Line starts a simple first-point/second-point
interaction and displays a live preview. Snapping is explained by a small
“Snapped to point a” label. Cancel is visible during an unfinished construction.
For precise placement, expose numeric fields with units and an Apply button.
These gestures require a new UI controller over engine primitives; do not
assume the current inline page script already provides a reusable interface.

**Modes:** show Draw, Inspect, and Move model. Keep Edit, View, and Pose in help
for continuity. Each mode has a one-sentence description. Entering Inspect or
Move model clearly changes the available controls without secretly drawing.
Move model provides labeled axes, numeric translation/rotation, and Reset.

**Inspection:** readable measurement details appear for a selected object. Use
advanced sections for pinning measurements and projector comparisons. Preserve
the distinction between editable drawing entities and inspection overlays.

**Check and submit:** Check my drawing appears only when permitted by the teacher
and model availability. If disabled, explain the reason. Never download or reveal
the teacher's hidden model through this UI. Show only feedback the student API
permits; do not derive hints from protected geometry.

**Submission:** show question title and a drawing thumbnail in a short confirmation
panel, then Send to teacher. Disable repeat activation while the request is in
flight. Confirm submission with the server response and a visible Back to
assignment action. A failed request preserves the drawing. Do not automatically
retry an ambiguous submission response until duplicate handling is established.

### 4.6 My drawings

Use a grid of drawing cards with thumbnail, title, last saved time, and Open
drawing. Provide an accessible list view for users who prefer it. Search and
sorting can be local over the returned drawing list. Put Rename and Delete in
a labeled action menu; include Rename only when the API can persist it.

Explain “You haven't saved a drawing yet” with a Start drawing button. Prompt
for a title on first save, offer a sensible editable suggestion, and do not
block later saves with the same prompt.

### 4.7 Guided learning

Present a simple sequence of topics: Points → Lines → Planes → Solids. Lesson
cards show a preview, a short description, and actual completion state. Avoid
invented streaks, leaderboards, XP, or estimated lesson durations.

Inside a lesson show Step 2 of 6 where the lesson data supports a step count,
one instruction, a short diagram, and a visible next or retry action. Offer Show
an example and Restart lesson. Completion uses existing tutorial progress where
applicable; a walkthrough animation must not mark an unfinished lesson complete.

### 4.8 Teacher home and classes

Prioritize Work to review, My classes, and Create assignment. Surface counts only
from authorized API results; avoid fetching every model drawing just to render
a dashboard. A class card has a title, shareable code, Open class, and Create
assignment. The class screen shows students and assignments in separate tabs.

Creating a class asks for Class name first. Put the required share code next,
with a readable suggested format and editable value. Show Copy class code after
the server confirms creation. Client-generated code suggestions still require
collision handling; they are not guaranteed unique.

### 4.9 Assignment builder

Replace the long all-in-one form with a three-step flow:

1. **Assignment details:** title, required code, and Class or Open assignment.
2. **Add questions:** prompt, optional hint, and the question list. Put bulk text
   and file import in a secondary Import questions action with a preview.
3. **Review and publish:** show what will be posted and where; publish through
   the existing create-set endpoint.

Preserve draft text locally while moving between steps, labeled “Draft saved on
this device” when true. This is not a server draft or cross-device sync.

Model answers are managed after publishing because question model endpoints
operate on existing assignments. For each question offer Attach saved drawing,
Draw model, and an optional Generate draft action if the current gateway is
available. A generated drawing is reviewed before attachment. Keep “Allow
students to check their drawing” and “Show students a 3D reference” independent.
Explain clearly that the model answer itself stays private.

### 4.10 Review student work

Use a review queue filtered by assignment and Needs review / All. A selected
submission opens the student's drawing in Inspect mode, with the question and
feedback form beside it. Show automatic check results separately from the
teacher's Pass / Fail / Ungraded choice and remarks.

Use Save feedback as the main action. Save feedback and open next can be added
once the next item is reliably determined. Do not introduce numeric marks or
rubrics while the backend supports only a verdict and remarks. Keep unsaved
remarks when switching filters unless the teacher explicitly discards them.

### 4.11 Help and appearance

Help offers “How do I draw a line?”, “How do I join a class?”, and other short
task articles, plus the full manual. A persistent Help button opens guidance
without replacing the current drawing.

Appearance uses labeled theme cards with a sample preview, comfortable text-size
preferences, and reduced-motion support. Theme selection changes color tokens;
it never rearranges navigation or alters engineering data.

## 5. Theme options

These are original design directions for this project. They share the same
navigation, components, spacing, and semantic drawing colors.

| Theme | Background / primary action | Character | Best fit | Tradeoff |
|---|---|---|---|---|
| **Warm Studio — recommended** | Ivory `#F6F2EA` / terracotta `#A8442E` | Friendly, tactile, editorial | Default novice experience; strongest visual departure | Keep orange/brown accents restrained around technical ink |
| **Blueprint** | Cool white `#F3F6FB` / cobalt `#2457C5` | Crisp, precise, contemporary | Formal institutional identity | Blue alone will not differentiate it from the current site; the new layout must do that |
| **Forest Classroom** | Sage white `#F1F6F2` / deep green `#1F6B52` | Calm, grounded, spacious | Long learning sessions | Green navigation accents must remain distinct from success states |
| **Soft Lilac** | Pale lavender `#F6F3FB` / violet `#6841BB` | Modern, gentle, expressive | A youthful academic identity | Use pale color on surfaces and strong color on actions; avoid pastel text |
| **Midnight Lab** | Charcoal `#151923` / lavender `#C1ABFF` | Polished, focused, subdued | Optional dark appearance | Keep drawing paper neutral/light by default; dark chrome does not imply dark technical ink |
| **Sunlit Paper** | Warm cream `#FFF8EB` / ochre `#8F5708` | Cheerful, clear, welcoming | A bright classroom identity | Yellow is decorative; use darker ochre for readable actions |

Start implementation with one light theme, preferably Warm Studio. After the
components and states are stable, theme tokens make the alternatives inexpensive
to add. Do not maintain six separate layouts or expose unfinished palettes as
production themes. Midnight Lab should follow a dedicated dark-surface review.

Interactive concept preview: `public/major2/themes.html`, served at
`http://127.0.0.1:8124/major2/themes.html` locally. Sample content is explicitly
marked and does not access an account or change any real drawing.

The concept preview was checked in headless Chromium on 7 October 2026:
six themes × two screens × four viewport widths (1366, 800, 390, and 320 px).
All 48 layouts stayed within the viewport; screen switching, tool instruction
selection, and theme persistence worked without browser exceptions. No account
API or external asset requests occurred. Five text color pairs per theme exceed
4.5:1. These checks validate the concept artifact, not the final application or
the usability targets below.

## 6. Design system specification

### Layout, type, and components

- Body text: 16 px desktop, 17 px where novice instructions benefit; line-height
  around 1.5. Forms and primary buttons use at least 16 px text.
- Secondary labels: usually 14 px. Reserve smaller labels for incidental metadata,
  never the only explanation of a control or the only indication of a state.
- Page titles: approximately 28–36 px; section headings 20–24 px. Avoid giant
  promotional titles inside a working screen.
- Use a locally available sans-serif stack initially. If a branded typeface is
  chosen, self-host a small font subset and include scripts needed for translations.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. Use consistent spacing rather than
  adding empty space indiscriminately.
- Card corners: 12–16 px; buttons and fields: 8–12 px. Modest shadows support
  hierarchy, with no hover movement that changes a pointer target unexpectedly.
- Main buttons and fields: about 48 px tall. Label icon controls clearly and keep
  their hit area at least 44 px as the product's default.
- Use a filled main button, outlined secondary button, and underlined links for
  navigation in prose. Destructive actions use explicit labels and separate placement.
- Create common components for navigation, buttons, fields, class cards, assignment
  rows, drawing cards, step headers, alerts, dialogs, empty states, and save status.

### Tokens and technical color semantics

Each theme defines `background`, `surface`, `surface-soft`, `text`, `muted`,
`border`, `primary`, `on-primary`, and `focus`. Success, warning, and error are
independent status tokens and always have text or icons.

Drawing ink, selected-object outlines, plane markers, reference geometry, and
inspection measurements use a separate token group. Select technical colors
against the actual paper background and verify meaning in monochrome. A theme
switch does not change first-angle layout, millimetres, line conventions, model
privacy, labels, or saved entity payloads.

### Accessibility acceptance criteria

Target WCAG 2.2 AA for the interface and document remaining canvas accessibility
limitations honestly. The palette preview alone cannot establish conformance.

- Normal text contrast is at least 4.5:1; qualifying large text uses at least 3:1.
  [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- Meaningful control states and essential graphics achieve at least 3:1 contrast
  against adjacent colors, where that criterion applies.
  [W3C non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- Product controls aim for 44–48 px targets. This is a design choice above WCAG
  2.2's 24 px minimum criterion, which has spacing alternatives and exceptions.
  [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Visible keyboard focus, logical focus order, properly labeled inputs, accessible
  errors, and text alternatives accompany core navigation and forms.
  [W3C design guidance](https://www.w3.org/WAI/tips/designing/)
- State meaning never relies on color alone. Check results explicitly say Matched,
  Not matched, or Check unavailable; review status names the teacher's verdict.
- Account screens work at narrow widths and enlarged text. A spatial drawing may
  require pan/zoom; surrounding controls and help must still reflow.
- Respect reduced motion. Avoid automatic animation or audio during drawing.
- Provide a keyboard-accessible object list and numeric properties for the canvas
  where the engine supports them. Scope and validate any remaining authoring
  access separately rather than claiming universal canvas accessibility.

## 7. Feedback, reliability, and device behavior

| Situation | Interface response |
|---|---|
| Loading a class or drawing | Brief Loading message and stable placeholder; avoid flashing an empty state |
| No data yet | Explain why and offer the first useful action |
| Invalid field | Message beside the field, preserve input, focus the problem |
| Network failure | Keep current work visible; explain failure and provide Retry |
| Save in progress | Saving indicator; prevent repeated activation until resolved |
| Save failed | “Not saved to your account. Your drawing is still open.” and Retry |
| Session expired | Preserve recoverable work, then request sign-in; do not silently switch accounts |
| Delete assignment | Explain that its submissions will also be deleted; confirm explicitly |
| Generated model unavailable | Offer manual drawing or saved-drawing attachment |

Local recovery storage is an enhancement, not a promise of offline sync. If added,
store only the active user's drawing draft under a dedicated versioned namespace,
handle quota errors, and clear or isolate it on account changes. Never cache private
teacher models for student access. Network actions are complete only after the
server confirms them.

Desktop and fine-pointer tablets get the full drawing toolbar. Touch-only devices
currently support viewing and moving models, not drawing authoring; account pages,
class joining, tutorials, results, and readable task descriptions should still be
designed for phones. Show a concise “Open on a computer to draw” explanation with
available viewing options. New touch authoring requires its own interaction and
precision work; it is not enabled merely by changing CSS.

Use content-driven breakpoints around 640 and 1024 px as starting points. At
1366 × 768, the drawing paper and core actions must remain usable. On a phone,
question and 3D views use tabs or an expandable panel, with controls outside the
pan/orbit area. Do not require hover to discover essential information.

## 8. Implementation in this repository

### Isolation

Put new frontend source under `ui-v2/` if a build step becomes useful; keep all
served Major 2 assets under `public/major2/`. The current preview uses plain HTML,
CSS, and JavaScript, and this plan does not require adopting a framework. Start
with modular JavaScript and theme variables; evaluate a bundler only if it helps
manage actual component dependencies.

Suggested structure, to be created during implementation:

```text
public/major2/
  index.html                 # app entry
  themes.html                # separate theme concept preview
  assets/                    # local fonts / icons / images if needed
  styles/tokens.css
  styles/components.css
  styles/drawing.css
  app/router.js
  app/session.js
  app/api.js
  app/screens/               # role and task screens
  app/components/            # common UI primitives
  app/drawing/engine-adapter.js
  app/drawing/controller.js
  vendor/                    # copied, versioned engine modules if needed
```

Reuse the C++ API and existing saved drawing schemas. Load existing geometry,
entities, viewport, reconstruction, and drafting libraries as dependencies without
changing their source for the first UI release. If packaging copies them into
`major2/vendor/`, automate that copy in a versioned build manifest; do not fork
their algorithms and then edit both versions independently.

The current `public/index.html` contains substantial inline engine/UI wiring.
Create a Major 2 adapter and controller around the reusable primitives. Port
required behavior into new files and verify parity. Do not assume styling the
old page inside an iframe yields the new drawing experience. Existing teacher
and student scripts also render old DOM classes; reuse their API behavior through
new controllers rather than loading their entire screen renderers into Major 2.

### API, session, and storage

- Resolve API requests from a stable mount base, not the current route string.
  `/major2/api/...` is rewritten to `/api/...` by the Nginx fragment.
- The direct local C++ server does not perform that rewrite. Configure a local
  proxy before integrating API-driven screens, or provide an explicit local API
  base in development configuration. Do not guess the deployment from the host name.
- Continue using the established bearer session and permissions. The current
  browser session key is `educad_session`; decide intentionally whether both
  versions share sign-in, and handle changes between tabs safely.
- Keep theme, hints, and Major 2 draft preferences under `educad_major2_*` keys.
  Do not overwrite legacy drawing preferences as an incidental theme effect.
- Assignment deadlines, server drafts, numeric grades, account recovery, and
  full offline sync need backend changes. They are future scope, not decorative UI.

The existing `deploy/nginx-major2.conf` is a configuration fragment, not proof
that the production route has been installed. Deployment includes serving the new
assets, installing the fragment with the actual static root/backend upstream,
validating Nginx, and checking both app mounts after reload.

## 9. Delivery sequence and review gates

| Phase | Deliverables | Gate before continuing |
|---|---|---|
| 1. Design prototype | Choose one theme; welcome, student home, drawing, and teacher review mockups | Novices identify the main action; sizes and contrast reviewed |
| 2. UI foundation | Tokens, components, routing, role shell, login, help patterns | Keyboard navigation and responsive layout work; auth permissions preserved |
| 3. Student account flow | Join class, assignment list, question page, saved drawings | Real API data; loading/empty/error states; no invented statuses |
| 4. Drawing integration | Engine adapter, named tools, instruction bar, inspector, 3D, save/check/submit | Geometry, undo, modes, model privacy, and saves retain correct behavior |
| 5. Teacher flow | Class creation, assignment wizard, models, review queue, remarks | Publishing and grading match current backend contracts |
| 6. Learning and refinement | Guided lessons, contextual help, optional dark theme, recovery if scoped | Real completion state; translation readiness; low-bandwidth and device review |
| 7. Parallel release | Major 2 deployment, route verification, documented limitations | `/major/` and `/major2/` both work; representative novice journeys pass |

For one developer familiar with the code, a usable overhaul is likely several
weeks of work. The drawing-controller migration is the main uncertainty. Estimate
dates after the first drawing prototype, rather than promising a full redesign
from the home-page mockup alone.

## 10. How to judge whether the redesign worked

Recruit 5–8 representative novices, including people with limited computer
experience, plus teachers. These are qualitative usability sessions, not a
statistically representative study. Use the old and new UI for comparable tasks
where practical, with the same devices and neutral instructions.

Student tasks: sign in, join a class, open a question, draw a simple line using
visible tools, undo a mistake, save, submit, and find the result. Teacher tasks:
create a class, create a two-question assignment, attach a model, and save feedback.

Provisional review targets, to validate rather than claim as achieved:

- A new user can identify what to do next without a spoken explanation.
- At least 4 of 5 initial participants complete class joining and opening a
  question without moderator intervention.
- First-time users can place two points and draw a line using buttons, without
  modifier keys or the command bar.
- Users can tell the difference between Saved, Submitted, and Teacher reviewed.
- A novice can recover from a drawing mistake using visible Undo.
- No participant loses typed work during the designed error/retry flows.
- Teacher task completion is no slower than the current flow after basic familiarization.

Engineering validation during implementation covers current geometry regressions,
draw/edit/inspect/pose boundaries, undo and cancel, saving/loading, teacher model
privacy, auth, submissions, and grading. Add focused UI checks for the new controller
and browser journeys, plus keyboard, enlarged text, narrow viewport, and theme
contrast checks. Aesthetic improvement does not substitute for correct geometry.

## Recommended first design decision

Choose **Warm Studio** as the initial identity, then prototype the student home
and drawing workspace together. The drawing screen is the strongest test of
whether this redesign is both approachable and a substantial departure from the
current application. Keep Blueprint as a formal alternative and Midnight Lab as
an optional later appearance.
