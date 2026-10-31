# EduCAD Major 2

Major 2 is the new, independent interface at **https://mitasia.in/major2/**.
The original interface remains at **https://mitasia.in/major/**.

## What is implemented

- Warm Studio is the default theme. Appearance offers Blueprint, Forest
  Classroom, Soft Lilac, Midnight Lab, and Sunlit Paper, with device persistence.
- A role welcome, student/teacher/academics sign-in, guest exploration, real
  home screens, contextual help, and visible error and empty states.
- Class creation, joining, leaving, membership lists, and shareable codes.
- A three-step assignment wizard with device drafts, question editing, text/JSON
  import, and review before publishing. Text limits match the existing API.
- A native drawing desk: point, line, circle, measurement and dimensions,
  coordinate/length/radius entry, linked properties, undo/redo, cancellation,
  paper movement, zoom, fit, and a collapsible guide with a resizable 3D view.
- Additional text, arc, projector, curriculum example, and validated command
  tools; JSON import/export and PNG export.
- Explicit account saves, drawing search/rename/delete, recoverable device
  drafts, submission, private model answers, saved-drawing attachment, automatic
  checks, teacher verdicts, and written feedback. Automatic results and teacher
  review appear separately.
- Actual 3D reconstruction, permitted teacher references, and constrained model
  pose previews with true orthographic projections. Pose changes do not alter
  stored drawing entities.
- Four action-based lessons: points, lines, square construction, and prism
  interpretation. Completion is saved through the existing progress API, or
  locally for guests.
- Touch devices support account/classroom tasks, inspection, paper pan/pinch,
  measurements, and model movement. Drawing authoring requires a mouse or
  trackpad, consistent with the current engine's support boundaries.

The optional teacher Generate drawing action uses the existing interpretation
service. Generated commands are staged and validated before one atomic commit;
unavailable service, invalid plans, and changed sessions preserve the paper.

## Isolation from the existing interface

All new markup, presentation, and interaction code is under `public/major2/`:

| File | Responsibility |
| --- | --- |
| `index.html` | New entry point and dependency loading |
| `style.css` | Responsive layout and design system |
| `drawing-workspace.css` | Grouped drawing toolbar, persistent step instructions, collapsible task/tool/property sections, precision/view disclosures, and compact mobile tool scrolling |
| `login.css` | Dedicated sign-in typography, layout, controls, and responsive detail |
| `core.js` | API connection, authentication, themes, dialogs, helpers |
| `login.js` | Student/teacher/academics sign-in, field feedback, and account help |
| `welcome.css` | Theme-aware drafting sheet, projection study, and responsive workspace access |
| `welcome.js` | Shared solid meshes, projection studies, and thumbnails for welcome/sign-in/teacher home |
| `teacher-home.css` | Teacher studio, folded class sheets, shared assessment briefs, and responsive navigation |
| `teacher-home.js` | Shared teacher shell, class sheets, assessment briefs, review data, code copying, and home projection views |
| `teacher-assignments.css` | Assignment library, paper folio, question sheets, and publishing styles |
| `teacher-assignments.js` | Full teacher/academics brief library, search, class filters, and review filtering |
| `teacher-workspaces.css` | Class galleries, rosters, review sheets, and matching class/grading controls |
| `teacher-workspaces.js` | Teacher/academics class pages, roster search, review filters, and actual submission previews |
| `teacher-studio.css` | Matching drawing cabinet, practice sheets, form artwork, teacher desks, and dialogs |
| `teacher-studio.js` | Teacher drawing previews, practice gallery, live form sheets, assignment visuals, and shared artwork |
| `student-home.css` | Student home hierarchy, paper briefs, question states, responsive navigation, and controlled background motion |
| `student-home.js` | Shared student shell and brief helpers, next-action selection, latest submissions, drafts, feedback, and home previews |
| `student-workspaces.css` | Matching student libraries, question sheets, class forms, drawing desks, feedback, and dialogs |
| `student-workspaces.js` | Student search and status filters, class actions, bounded drawing previews, practice, submission history, and desk hierarchy |
| `student-canvas.css` | Drawing-first student layout, separate model dock, Focus mode, and workspace customization |
| `student-canvas.js` | Versioned account-scoped preferences, live preview/Cancel/Reset, model visibility/source, and layout controls |
| `student-line-types.js` | Stroke samples, keyboard-accessible line-type picker, and a fallback for browsers without popovers |
| `student-canvas-window.js` | Optional floating 3D window, bounded movement/resizing, minimize, keyboard controls, and responsive docking |
| `app.js` | Navigation and student/teacher workflows |
| `drawing.js` | Independent canvas renderer and drawing controller |
| `themes.html` | Sample-only theme concept explorer |
| `vendor/` | Generated copies of the existing geometry/engine modules |

The new app does not embed the old interface. The implementation does not edit
legacy frontend files or the backend. Both interfaces share the current
accounts, classes, drawing schema, and server APIs. Signing out invalidates the
shared account session as expected. Presentation settings and drafts use
separate `educad_major2_*` keys, and drafts are scoped to the current account.

To overhaul Major 2 again, edit its own files. Reuse engine functions through
`vendor/`; make UI changes in `drawing.js`, rather than in shared engine source.
Rebuild the dependency package after intentional engine updates. Its manifest
records SHA-256 hashes so the source of every packaged module can be checked.

## Interactive welcome sheet

The welcome screen at **https://mitasia.in/major2/#/welcome** is composed as an
engineering drawing sheet, with a fine paper grid, construction lines, and a
large projection study. Visible copy is limited to “Explore every view,” short
control labels, and the guest-save notice. Student, teacher, guest, and academics
access use the existing routes and session behavior.

The projection explorer provides a stepped block, hexagonal prism, and pyramid.
Each illustration uses a shared three-dimensional mesh to produce the selected
isometric, front, top, or right-side view and three linked orthographic studies.
First-angle placement puts the top view below the front view and the right-side
view to its left. Dashed edges indicate hidden geometry. Dimensions identify
the example solids; the illustrations are explicitly marked not to scale.

The explorer supports native keyboard controls, visible focus, pressed states,
live descriptions, reduced motion, and the existing Appearance palette. View
buttons include projection thumbnails; solid selection uses visual buttons with
accessible names and hover titles. Get started scrolls to workspace access
without changing the app route. Phones keep a short heading above the drawing
and three compact workspace controls in a row. The screen uses local SVG and
CSS without new dependencies or external assets.

The minimal-copy refinement was checked in native headless Chromium at 320,
390, 760, 980, and 1280 pixels. All twelve solid/view combinations, projection
thumbnails, touch-target sizes, horizontal overflow, the starting-point jump,
Midnight Lab appearance, and student/teacher/academics/guest navigation passed.
No browser runtime exceptions were recorded. Syntax checks pass.

Browser review covered 320, 390, 760, 980, and 1280 pixel widths, all twelve
solid/view combinations, pressed states, the starting-point jump, and Midnight
Lab appearance. Student, teacher, and academics navigation and guest entry
through to the drawing canvas were checked without submitting account forms.
The 320-pixel welcome layout was checked against the available viewport width
after fixing its horizontal scroll. JavaScript syntax checks pass. These checks
cover this welcome refinement; the full classroom regression suite was not run.

## Focused sign-in refinement

Student, teacher, and academics sign-in use the welcome screen's drawing-sheet
composition at **https://mitasia.in/major2/#/login/student** and the corresponding
teacher/academics routes. The grid, cube brand, serif heading, square controls,
and shared projection renderer keep these screens visually consistent.

The form sits beside a large stepped block, hexagonal prism, or pyramid for the
selected account type. Visible copy is limited to “Sign in,” field and control
labels, and the guest-save notice. Phones use a centered form with faint solid
linework behind it; background diagram labels are omitted. Touch devices
requesting a wide viewport retain a larger, single-column form.

The form includes an accessible password-visibility icon, Caps Lock hint,
field-specific missing-value messages, a pending state, and understandable
connection and credential errors. Keyboard focus and screen-reader feedback
are included. Typed details survive a failed request. Switching account types
keeps each username in memory for this page session without retaining passwords.

Account help and demo details expand inline. Filling a demo account returns
focus to Sign in without submitting it. Guest access stays below the form.
The existing appearance choices and original-version link remain available.

Native Chromium checks covered all three roles at 320, 390, 760, 980, and 1280
pixels in Warm Studio, Blueprint, and Midnight Lab (45 layout combinations).
Role illustrations, horizontal overflow, touch targets, demo filling, help,
password visibility, required-field errors, loading, rejected credentials,
connection errors, preserved usernames, cleared passwords on role changes,
and guest access passed. Additional checks covered coarse-pointer wide layouts,
Caps Lock feedback, expanded assistance, and successful session/redirect handling
for every role. Authentication success and error states used API stubs without
submitting credentials to the live server. The welcome screen
was also checked after the renderer was shared. No runtime exceptions were
recorded; syntax checks pass. The full classroom suite was not rerun.

## Teacher workspace home

Teacher and academics home now use a visual teaching desk at
**https://mitasia.in/major2/#/home** after signing in. The paper grid, cube brand,
serif heading, square controls, and theme colors match the welcome and sign-in
screens. A large prism study switches between 3D, front, top, and side views
through visual thumbnails projected from the same mesh. Visible copy is kept
to short headings, action labels, and actual classroom data.

The desktop layout uses an icon rail, three folded class sheets, numbered
assessment briefs, and a review panel. Phones use a bottom navigation bar and
horizontally scrollable class sheets with the scrollbar hidden. Each sheet
opens its class and includes a separate code-copy button, with a selectable-code
dialog when clipboard access is unavailable. New assignment, blank drawing,
new class, review,
saved drawings, and practice shortcuts use the existing routes.

Home assessments look like drawing briefs, with a numbered paper illustration,
assignment code, short title, class, and question tiles. The tiles reflect the
real question count, showing the first five plus a remainder for longer sets.
A small pending-review marker uses the same submission data as the review
panel, without additional API requests. It appears only after a successful
queue read and only when that assignment has work awaiting review.

Classes, assignments, and drawings use existing authenticated APIs. The review
count includes every unreviewed submission from the returned assignments,
with the latest three shown. Submission reads are limited to four concurrent
requests. A failed request shows an unavailable state and retry instead of a
partial count; navigating away or changing accounts prevents stale updates.
Empty states offer short creation actions.

Focused native Chromium checks passed all six themes at 320, 390, 760, 980,
and 1280 pixels (30 layouts), including overflow and control sizes. Checks
also covered projection controls and keyboard operation, real-data counts,
newest-first review items, bounded API concurrency, class-code copying and
fallback, all primary shortcuts, account/help/appearance, empty states,
connection failures and retry, long and escaped names, navigation during
pending requests, and teacher/academics/student/guest home selection. No
runtime exceptions were recorded.

The full classroom browser suite passed all 18 workflow groups against a
disposable SQLite database, including teacher class and assignment creation,
student submission, review, and the home count changing from zero to one and
back to zero after grading. It also checked 96 existing workspace layouts,
drawing tools, saving, feedback, lessons, recovery, and touch behavior.
Live-data mutations were not used for validation. JavaScript syntax checks
pass.

The assessment refinement passed the 30 teacher theme/width combinations,
question maps (including 40-question sets), pending markers, failed-queue
states, navigation, and clipboard behavior. Class scrollbar checks cover
native touch swiping, programmatic scrolling, keyboard access to later sheets,
and both standard and WebKit scrollbar styling. The classroom suite also
checks the assessment marker appearing on submission and clearing after review.

## Full teacher Assignments page

The full teacher and academics Assignments page at
**https://mitasia.in/major2/#/assignments** shares the home studio shell and
numbered drawing-brief renderer. A paper folio and short “Drawing briefs”
heading introduce a responsive library with actual brief and question counts.
The gallery shows all assignments, with their codes, class names, question
tiles, and accurate pending-review markers.

Search matches title, code, or class. A class selector includes open assignments,
and All/Needs review controls combine with both search and class selection.
No-result states offer Clear filters. Review filtering becomes available only
after the shared, bounded submission reads succeed. Failed review reads keep
the briefs available, show a short retry message, and leave review filtering
disabled. Navigating away prevents stale updates. Empty libraries offer a
new-assignment action without review requests.

Opened assignments and the publishing wizard use the same teacher rail,
serif headings, square controls, and paper surfaces. Model answers, saved
drawing attachment, reference visibility, student work, and publication use
the existing handlers. Student assignment access uses its existing interface.

Native Chromium checks passed 90 theme/width layouts: the library, opened brief,
and publishing form at 320, 390, 760, 980, and 1280 pixels in all six themes.
Search, intersecting filters, question/review totals, keyboard opening, class
selection, empty and failure states, retry, long/escaped names, detached-page
responses, and academics/student routing passed. The 30 home layouts and
focused home checks also passed after sharing the review loader.

The classroom suite passed all 19 workflow groups against a disposable database,
including real assignment search/filtering, publishing, private model answers,
student submissions, grading, and feedback. It also passed 96 existing workspace
layouts. No browser runtime exceptions were recorded, and syntax checks pass.

## Teacher My classes and Review work

Teacher and academics My classes at **https://mitasia.in/major2/#/classes** and
Review work at **https://mitasia.in/major2/#/review** share the studio navigation,
paper grid, projection folio, serif headings, and short action labels used by
home and Assignments. Phones keep the shared bottom navigation.

My classes displays all classes as folded drawing sheets with actual membership
and assignment counts. Search matches class name or code. Each sheet opens the
class and offers code copying, including the selectable-code fallback. Class
details include matching assignment briefs, accurate review markers, and a
searchable student roster. New class and New assignment keep their existing
workflows. Class deletion keeps its confirmation and existing API behavior.

Review work presents student submissions as drawing sheets with previews of
their actual saved entities. Each sheet includes the student, assignment,
question, date, manual verdict, and separate automatic check result. Feedback
expands within the sheet. Needs review/All work, student or assignment search,
and assignment selection combine to filter the board. Opening a sheet uses the
existing immutable submission viewer and grading form, with matching square
controls and paper styling.

Review totals use the shared loader with at most four concurrent requests.
A failed queue read leaves totals unavailable, offers Retry, and avoids partial
counts. Submission previews load near the viewport with a separate limit of
four requests. Preview failures offer their own retry while the review link
stays available. Navigation or account changes prevent stale responses from
updating the screen. Empty libraries, completed queues, and unmatched searches
have short, distinct states.

Native Chromium checks passed 150 layouts across all six themes at 320, 390,
760, 980, and 1280 pixels for the class library, class details, creation form,
review board, and grading viewer. Ten focused checks covered search and combined
filters, actual drawing previews, exact totals, bounded request concurrency,
clipboard fallback, class actions, preview/queue retries, empty states,
long/escaped names, detached responses, and academics/student routing.

The full classroom suite passed all 20 workflow groups and 96 existing workspace
layouts against a disposable database. It covered class creation, assignment
publication, student submission, actual review previews, immutable grading,
and student feedback. No browser runtime exceptions were recorded; syntax
checks pass. Live validation used isolated fixtures without classroom mutations.

## Remaining teacher studio pages

Teacher and academics Drawings at **https://mitasia.in/major2/#/drawings** and
Practice at **https://mitasia.in/major2/#/learn** now share the same teacher
studio shell. All six workspace destinations stay visible in phone navigation.
The drawing cabinet pairs an interactive stepped-block projection study with
actual saved-drawing sheets, title search, renaming, and confirmed deletion.
Previews load near the viewport with at most four requests in flight, offer
Retry after a failure, and stop updating when navigation or account changes
dispose the page. A failed preview keeps the saved drawing link available.

Practice uses illustrated coordinate, line, plane, and solid sheets. Completion
markers reflect the existing progress API. All four lessons retain their action
requirements and open the same drawing engine with matching teacher styling.
The hero's 3D/front/top/side controls use the shared projection renderer.

New class and all three publishing steps include a full projection sheet beside
the form. Typed titles and codes update the sheet immediately. Assignment
question counts become numbered tiles after adding or editing questions. Device
drafts, import, validation, publication, and creation use the existing handlers.
Visible form hints and draft labels are shorter.

Opened assignments pair each question with its actual private model or permitted
3D reference. A question without a model uses decorative geometry labeled as a
projection study. Model attachment, removal, drawing checks, reference visibility,
and student work retain their existing controls. Teacher drawing, saved drawing,
model, lesson, and review desks use square controls, serif titles, and drafting
surfaces. The guide includes an explicitly illustrative projection study; its
controls do not change the actual drawing entities.

Help, Appearance, account, and drawing dialogs match the studio paper and controls.
Teacher help lists classroom tasks, and Appearance uses visual ink swatches.
Geometric artwork also fills empty class, assignment, and review panels and
connection-recovery screens. Footer projections complete shorter page layouts.
All artwork is local SVG/CSS with no new dependencies or external image assets.

Ten focused native Chromium checks passed, including 270 layouts across nine
teacher routes, five widths (320, 390, 760, 980, 1280), and all six themes.
They covered preview/search behavior, request limits, retries, detached responses,
rename/delete/open, lesson progress and routing, live form artwork, publication,
private models, actual 3D references, escaped titles, dialogs, phone navigation,
and academics/student selection. Final checks also covered empty panels and
connection recovery at three widths in Warm Studio, Blueprint, and Midnight Lab.

The full classroom suite passed all 21 workflow groups and 96 existing workspace
layouts against a disposable database, including the teacher drawing cabinet,
model saving, student submission, immutable grading, and feedback. No uncaught
browser errors were recorded. Syntax checks pass. Live-page checks used isolated
fixtures; classroom data was not mutated.

## Student home: actions before artwork

Student home at **https://mitasia.in/major2/#/home** uses a compact drawing desk.
The first screen leads with the next real action and puts assignment sheets
directly below it. Feedback, saved drawings, class links, and practice occupy
the second column. The columns flow independently so long feedback lists do
not push assignments down. Phones retain the main action and assignments first,
followed by feedback and saved work. Six compact navigation destinations include
Assignments and Feedback.

The primary action prioritizes the latest submission needing teacher-requested
rework, then the most recent unfinished device draft for the current account,
then an unanswered question. Submitted work links to its immutable viewer while
awaiting review. When every question has been sent and reviewed, practice becomes
the next action. Empty accounts lead with joining a class or opening a brief
by code; accounts with classes but no briefs link to the existing classroom.

Question tiles open the exact drawing or submission, showing Not submitted,
Awaiting review, Pass, or Needs work. Progress counts unique questions submitted,
including work awaiting review; it does not call automatic matching a teacher
verdict. The newest attempt for each question replaces older attempts in the
home state and feedback panel. All work opens the full submission history.
Saved work shows the two most recently updated drawings with actual thumbnails.
An unavailable thumbnail leaves its drawing link usable. Navigation and account
changes prevent stale preview updates.

Art lives inside the actionable paper and its background, without a separate
hero illustration consuming space. Faint solid outlines, first-angle projection
linework, and slow construction traces support the drafting theme. The main
action and question controls remain still. A Pause/Resume background motion
button stores the student's preference and respects device reduced-motion
settings. Home account, appearance, and help dialogs use matching square controls.
The remaining student pages now use the same studio shell, paper language, and motion preference.

Ten focused native Chromium checks passed, including all six themes at 320,
390, 760, 980, and 1280 pixels. They checked that the next action remains above
the fold, question targets are at least 44 pixels high, and assignments follow
the main action without a gap from the feedback column. Checks also covered
rework/draft/new-question priorities, newer attempts, waiting and reviewed work,
zero-question briefs, real drawing previews, native links, onboarding/code entry,
motion controls and reduced motion, API failure/retry, detached responses,
escaped titles, and account tools. No browser exceptions were recorded.

The full classroom suite passed all 22 workflow groups and 96 existing workspace
layouts against a disposable database. It includes the student's exact next
question opening alongside model privacy, student submission, immutable teacher
grading, and feedback. Syntax checks and live-file verification pass. Browser
fixtures did not mutate live classroom data.

## Remaining student pages

Assignments, Classes, Drawings, Practice, and Feedback share the home navigation,
palette, paper grid, square controls, and subdued projection artwork. Page
headings are compact and actionable content starts immediately below them.
Artwork occupies backgrounds, paper margins, and useful drawing previews.

Assignments lead with the next actual question needing rework, an unfinished
account draft, or an unanswered question. Search accepts assignment titles,
codes, class names, and class codes. Status filters use the latest attempt per
question. Brief tiles open the exact question or immutable submission and count
unique questions sent. Full briefs show prompts and drawing actions first,
with hints and authorised 3D references in expandable sections. Question jump
buttons scroll within the brief without changing the app route. Private model
answers remain inaccessible to students.

Classes provide searchable classroom sheets and the same brief gallery inside
each classroom. Code copying, join validation, and confirmed leaving keep their
existing APIs. The join form has a faint embedded study rather than an extra
art column. Saved drawings show actual previews, loaded only near the viewport
with at most four requests in flight. Search, rename, confirmed deletion, and
preview retry remain available. A failed preview leaves its drawing link usable;
late results are ignored after navigation, disposal, or account changes.

Practice offers four illustrated lesson sheets and actual completion status.
The drawing desks retain their canvas, geometry, save, check, submit, undo,
inspection, touch restrictions, and guided lesson behavior. Student styles frame
the paper and controls without adding a decorative panel. In submission viewers,
teacher feedback follows the prompt before secondary inspection tools. Feedback
pages retain all attempts, label earlier attempts, and distinguish automatic
checks from manual teacher verdicts. Only the latest failed attempt offers a
rework action. Search, status filters, recovery screens, and supporting dialogs
match the studio.

`node tools/test-major2-student-browser.js` uses an isolated browser profile and
read-only injected fixtures. Ten focused groups cover route continuity, real
question priorities, newer attempts, draft continuation, reference visibility,
class actions, preview failure/retry and request bounds, immutable feedback,
practice tools, reduced motion, empty states, recovery, escaped names, and late
responses. It checks all six themes at 320, 390, 760, 980, and 1280 pixels across
13 student routes (390 layouts), including 44-pixel main controls and usable
drawing paper. The full classroom suite also passes 22 workflow groups and 96
layouts against a disposable database. Neither test suite changes live accounts.

## Student canvas roadmap and step 1

[STUDENT_CANVAS_PLAN.md](STUDENT_CANVAS_PLAN.md) records the construction workflow,
current implementation audit, 12 numbered delivery stages, acceptance criteria,
customization coverage, and primary engineering-drawing references. Only step 1
is delivered in this round; later stages remain planned.

Student drawing screens now give paper the dominant area and separate the
scrolling task/tools guide from bounded 3D support. Guide and model visibility
are independent. Focus hides both support areas, keeps drawing and recovery
controls available, and has an explicit Exit focus action. 3D is docked by
default. Students may explicitly float and position its window; Focus hides it.
The model never starts an automatic orbit. A small status distinguishes
reconstruction from the student's drawing, an explicitly chosen permitted
teacher reference, and unavailable 3D. Empty compact previews do not reserve a
large blank model stage. Student model stages fit the resting geometry to their
available size while preserving orbit direction and user zoom. Deliberate model movement reveals hidden model controls
without changing saved entities. Narrow screens place paper first, then model
support and instructions; the existing touch inspection restriction remains.

Workspace opens a live customization preview. Preferences cover panel side and
width, guide visibility, Focus, compact/expanded/hidden 3D, UI density, four paper
palettes, labels and their size, view captions, grid visibility and spacing, and
optional grid-snap spacing. Paper palettes are independent of the six app themes;
dimension text follows the chosen paper ink even when point labels are hidden.
Cancel/Escape restores the previous presentation. Save preferences writes a
normalized versioned record under `educad_major2_canvas_<account>` on this device;
Reset workspace changes display preferences and leaves drawing entities intact.
Unavailable storage leaves the current session usable. Late saves after a token
change are ignored. Existing More grid/snap toggles use the same preferences.

Presentation changes do not create undo entries, modify entities, change the
active tool step, rescale dimensions, or alter submitted copies. Switching the
drawing input method is applied on Save preferences and cancels unfinished input
without changing committed geometry; preview/Cancel preserves that input. The normal
drawing engine still owns pointer input, undo, saves, checks, lessons, model pose,
and permissions. Teacher and guest workspaces keep their existing behavior.

`node tools/test-major2-canvas-browser.js` checks actual pointer drawing, live
preview/Cancel, draft restoration, snapping, geometry invariants, account/storage
safety, references, 3D orbit/pose and read-only review. Layout checks cover six
app themes, five widths plus a short laptop screen, left/right panels, Focus and
hidden-panel recovery. The existing classroom suite covers actual account saves,
submission, teacher review, lessons, touch restrictions, and failure recovery in
a disposable database. Fixture checks do not mutate live classroom data. The
final runs passed nine canvas workflow groups and 144 canvas layouts, plus 22
classroom workflow groups and 96 existing workspace layouts, with no uncaught
browser errors. JavaScript syntax and live/local frontend asset checks passed.
Recorded results: [STUDENT_CANVAS_RESULTS.json](STUDENT_CANVAS_RESULTS.json).

The original Drawing method choice is available at Workspace → Drawing method:
Draw menu or Shortcuts. A visible method button on the tool row opens that
setting directly. Draw menu retains explicit tools; Shortcuts hides the point,
line and circle choices and restores direct clicks, Ctrl/Cmd-click point banking,
line-style selection, the shared three-point circle calculation, double-click
rename, axis-locked typed distance and Enter, Escape cancellation, Tab from the
paper into/out of model preview, and slash access to precise commands. Numeric
fields and dialogs keep their own keyboard input. Read-only review and touch
inspection cannot author through shortcuts. Method choice persists with the
other account-scoped device preferences.

`node tools/test-major2-method-browser.js` passes 14 focused workflow groups and
48 method layouts across six themes and four viewport sizes. The canvas suite
passes its nine groups and 144 layouts; the classroom suite passes 22 groups and
96 layouts. All three runs report no uncaught browser exceptions.

The 3D header now offers Float/Dock. A floating window has its own move handle,
resize corner, minimize/restore and keyboard arrows (Shift accelerates changes).
Model drag, scroll/pinch zoom and keyboard orbit operate inside the preview,
independently of the frame. Workspace → 3D placement selects docked/floating;
Floating window exposes exact pixel dimensions, minimized state and section
reset. Preferences remain local to the student account on the device. Window
bounds adapt to the workspace; at 760 px or narrower, support docks automatically
and retains the desktop choice. Empty compact models do not create a large
blank window, and explicitly permitted references remain reachable.

`tools/check-major2-window.js` installs isolated checks in the collaborative
preview, then exposes `__windowChecks.setup()`, `__windowChecks.run(name)` and
`__windowCheckLayouts()`. Nine groups and 168 layouts passed. Native keyboard
and line/undo clicks were checked separately; drag/pinch/wheel checks dispatch
pointer events with temporary capture shims. The save check uses an in-memory
fixture, with no live API writes. The six frontend assets match the live site.
Previously recorded classroom/method suites were not rerun for this follow-up.
Workspace Cancel/Escape now resolves immediately, and canonical drawing
fingerprints correctly clear draft status after save or undo to saved geometry.

Selecting Line now reveals its line-type control in the toolbar, including in
Focus. Five choices use the engine's existing codes: visible edge (A), thin
construction (B), hidden edge (E), centre line (G), and alternate position (K).
Samples show the actual cosmetic dash pattern and stroke weight. Pointer and
typed-length construction use the selected type, and the temporary preview
shows its pattern. The student's last choice is stored with workspace
preferences and is configurable at Workspace → Default line type.

Changing type preserves an unfinished endpoint and typed length/angle. The
picker supports keyboard arrows, Home/End, Enter, outside dismissal and Escape;
Escape closes the picker while preserving the construction. It floats above
the toolbar's scrolling area and has a fallback when native popovers are
unavailable. Shortcut confirmation has the same five samples and remembers the
selected type. Construction (B) and alternate position (K) now have distinct
labels in that confirmation. Fit/Zoom have compact, named icon controls to
keep the toolbar and paper stable on laptops.

`node tools/test-major2-line-types-browser.js` runs seven isolated workflow
groups and 30 layouts across five viewport sizes and six themes. It checks
stored styles, rendering previews, dependencies, typed dimensions, cancellation,
Focus, shortcut lines/circles, preference isolation, saved work, immutable
review, and popover fallback. The save fixture is in memory; it never writes
to the live API. Native collaborative-browser clicks and key presses also
verified keyboard selection, Escape preserving an endpoint, styled drawing,
and undo. Results are appended to [STUDENT_CANVAS_RESULTS.json](STUDENT_CANVAS_RESULTS.json).

## Run locally

```sh
npm start
```

In another terminal:

```sh
npm run dev:major2
```

Open **http://127.0.0.1:8126/major2/**. The development server serves this
frontend and proxies `/major2/api/` to the C++ backend on port 8124. It has no
additional npm dependencies. Override `MAJOR2_PORT` or `MAJOR2_BACKEND` if needed.

`npm start` automatically packages Major 2 dependencies through `prestart:cpp`.
For static deployment, run `npm run build:major2` before serving the frontend.
Generated vendor files are ignored by Git and must be generated on a new
checkout. Opening `/major2/` directly on the C++ port 8124 serves static files
but does not provide the prefix API rewrite; use the development proxy.

## Nginx

[`deploy/nginx-major2.conf`](../deploy/nginx-major2.conf) contains the additional
locations. The current checkout's public root is `/root/major/gg-lab/public`.
If deploying elsewhere, update that root and the backend address.

The live server loads the fragment from
`/etc/nginx/snippets/major2-locations.conf`, included inside the existing server
block in `/etc/nginx/sites-enabled/default`. This server uses a regular enabled
config copy; the matching `sites-available/default` copy is also updated. `/major2` redirects to `/major2/`;
`/major2/api/...` proxies to `127.0.0.1:8124/api/...`. Real missing assets return
404. Navigation uses hash routes, so no catch-all HTML fallback is needed.

After deployment changes, validate with `nginx -t`, then reload Nginx. Removing
only the Major 2 include disables this interface without changing `/major/`.
An explicit 120-second proxy read timeout supports the existing optional drawing
generation service. Frontend assets use `Cache-Control: no-cache` for updates.

## Checks and practical limits

`npm run test:major2` runs the native Chromium browser checks against a temporary
SQLite database and separate ports (8134 backend, 8127 proxy, 9337 Chromium).
It covers student/teacher journeys, model privacy, saving/submission/review,
draft recovery, all four lessons, dependencies, invalid input, failure recovery,
themes, and responsive layouts. It does not write test work to the live database.
Set `MAJOR2_CHROMIUM` to your Chromium executable if the cached path differs.
Screenshots and results are written to a reported `/tmp/major2-browser-*` folder.

Human usability sessions with novice students remain necessary before claiming
the design is proven easy to use. The initial interface uses English. Additional
languages, numeric grades, due dates, account recovery, server autosave, and a
full migration of the old scripted tutorials require separate work. Local draft
recovery is distinct from an explicit account save; it is not cross-device sync.

The design specification is [MAJOR2_UI_PLAN.md](MAJOR2_UI_PLAN.md). The theme
concept explorer at `/major2/themes.html` uses sample data; `/major2/` uses live
API data after sign-in.

### Collapsible drawing desk

New student workspaces start with the guide and 3D support closed; saved workspace preferences are respected. Coordinates and exact length/radius entry open from the current-step bar. Selecting an object opens its collapsible properties. Question, Precision, View, and 3D controls open independently. Inspection hides creation tools; model movement hides the drawing tool group. Practice instructions and review feedback remain visible, and the solid lesson opens its model.

Run `MAJOR2_PREVIEW_URL=http://127.0.0.1:8126/major2/ node tools/test-major2-disclosures-browser.js` for isolated interaction and responsive checks. Set `MAJOR2_CHROMIUM` if Chromium is installed outside the default Playwright cache.

### Drawing sheet flow refinements

Empty editable free-drawing sheets offer a compact starting card with a paper
placement action and direct coordinate entry. It disappears as soon as geometry
or an unfinished construction exists, and stays out of assignments, lessons,
shortcut mode, and read-only inspection. The current tool is marked in the
instruction strip, with an emphasized border during a two-point construction.

View and Precision controls float over the workspace without resizing the paper.
Only one of these menus opens at a time; outside clicks dismiss it, and Escape
returns focus to its trigger while preserving an unfinished drawing step. Save
status retains its explicit device/account wording and adds a small visual marker.

The isolated disclosure browser suite covers the starting actions, keyboard focus,
stable paper bounds, Escape preserving an endpoint, drawing and inspection flows,
and expanded/collapsed layouts at five widths in Warm and Midnight themes.

### Optional student drafting aids

Workspace → **Drafting aids** contains nine independent switches. They use the
existing account-scoped, device-local preference record, live preview, Cancel,
Reset, and preset handling. Quiet switches off cursor dimensions, smart guides,
linked highlighting, selection actions, checkpoints, review, and the pinned brief.
The underlying drawing tools remain available when aids are off.

- **Cursor dimensions:** after choosing the first endpoint or centre, type a
  length/radius beside the cursor. Tab reaches the angle; Enter commits through
  the existing atomic drawing history. Escape from a field returns to the paper
  without deleting the first endpoint. Available in Draw menu mode.
- **Smart guides:** endpoint, centre, midpoint, perpendicular-foot, and X/Y
  alignment snaps use a screen-distance tolerance. Corresponding front/top
  points can align at the same X. Disabling the aid retains the original
  endpoint/grid behavior and does not move existing geometry.
- **Linked highlighting:** hovering/selecting sheet geometry highlights matching
  reconstructed vertices/edges in front, top, side (where present), and 3D.
  Hovering the student's 3D model highlights its projected geometry. This does
  not match against teacher references or a posed preview.
- **Find tool:** Ctrl/Cmd+K opens searchable available tools and workspace actions;
  arrow keys and Enter work without a mouse. Disabled/hidden drawing tools are
  excluded in inspection mode.
- **Selection actions:** a compact sheet bar opens the selected object's
  properties or its existing confirmed deletion flow. Read-only work has no
  deletion action.
- **Drawing layers:** four categories group points/edges, construction/centre
  lines, dimensions, and annotations. Show/lock choices are session-local;
  enabling the feature is a saved preference. Locks reject entire edits that
  would change connected locked objects. Visibility is presentation-only; account
  saves include all categories. Undo/redo remain available.
- **Named checkpoints:** up to 12 snapshots per sheet on this device. Restore
  requires confirmation and is undoable; unavailable storage reports failure.
  Saving a new sheet migrates its checkpoints to the saved sheet's key. These
  are distinct from account saves and are not cloud version history.
- **Review sheet:** basic suggestions locate points without visible labels and
  edges with open endpoints; a missing principal view prompts a task check.
  Findings are explicitly not grades. Existing authorized teacher checking and
  submission actions remain separate and optional.
- **Pinned brief:** assignment sheets offer a collapsible question and
  Draw → Inspect → Review → Submit actions. Review opens suggestions; Submit
  retains the existing confirmation. No stage is claimed complete automatically.

`node tools/test-major2-assist.js` covers snap geometry and review rules.
`MAJOR2_PREVIEW_URL=http://127.0.0.1:8126/major2/ node tools/test-major2-assist-browser.js`
uses isolated, in-memory classroom fixtures to check preference preview/persistence,
exact input and undo, snapping, command search, layer locks including connected
edits, checkpoint restoration, read-only behavior, bidirectional linked selection,
reference isolation, assignment navigation, and layouts at five widths. It does
not write to live classroom APIs.
