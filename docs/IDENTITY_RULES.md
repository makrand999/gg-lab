# Drawing identities and editing rules

Geometry belongs to stable IDs. Display labels do not establish relationships.
This is a contract for editing and reconstruction, not a claim of formal verification
or exact arithmetic throughout the application.

## User choices

Select a point, open **Edit** (Major) or its properties (Major 2), and choose:

- **Display label only**: change or clear the caption without changing members,
  coordinates, dependencies, visibility verdicts, or reconstructed geometry.
- **Rename linked member**: change one member's base name across its explicitly
  linked stations. Select the member when a station contains several corners.
  Each station retains its own hidden verdict.
- **Assign station members**: explicitly replace the corners represented at a
  station. Enter comma-separated base names with optional projection primes;
  parentheses mark a hidden member. An empty list removes membership. Names
  resolve only against previously declared members. If several IDs share a name,
  choose an exact ID with `@member-id`; ambiguity never picks the first match.
- **Keep projections linked**: coordinate edits propagate through shared member
  IDs and attached endpoint IDs, using the projection equations.
- **Detach this station**: give its members new identities before moving it.
  Other projections remain in place. Attached lines still follow the station.

The **Project** tool establishes a relationship explicitly. Merely typing the
same label on two new points no longer pairs them. Neither a matching label nor
coincident coordinates merges point identities. A shared station can contain
several distinct members even though they occupy the same projected position.

Clearing a label does not delete a point. Use the Delete action for deletion.

Commands support the same distinctions:

```text
/rename <point-name-or-entity-id> <label> local
/rename <point-name-or-entity-id> <base-name> linked [member-id]
/rename <point-name-or-entity-id> <station-caption> members
```

Command references accept an exact entity ID or an unambiguous name. An ambiguous
name is rejected. The command interface continues to reject duplicate local
labels; point properties permit aliases because identity is independent of them.

In Major, Ctrl/Cmd-click asks which corner to bank when a hit contains several
points or several members at one station. A line's destination uses the same
chooser, including when changing the destination before choosing a line style.
Single-member stations resolve directly. New explicitly selected lines store
`meta.endpointMemberIds` in the same order as `meta.refs`; local label changes
cannot retarget them. Reconstruction restricts each endpoint to its chosen
member and does not substitute another coincident member if that identity becomes
stale. Explicit projectors only pair their selected corners. Legacy lines and
scripted tutorial steps without endpoint choices retain their existing behavior.

## Model and invariants

A point entity has an immutable `id`. `meta.members` is an array of
`{id, name, hidden}` records representing spatial corners. A member ID may occur
in several projections; its base name must agree across those records. A station
cannot contain the same member twice. An explicit empty array means unassigned.
The shared base name is a semantic name; `caption` is a local display label.

`meta.membersDeclared` records explicit assignment or linking. Temporary initial
names do not make a station a candidate for name-based member assignment.
`meta.fromMemberId` identifies a claimed corner independently of its display name.
Existing endpoint references, circle center/rim references and polygon references
continue to use entity IDs. Label changes normalize legacy references before
committing, so subsequent edits do not re-resolve those references by text.

Projection constraints use world millimetres:

```text
front = (x, height)
top   = (x, -depth)
side  = (xRef + s * (depth - dRef), height), s in {-1, +1}
```

Assignment and linking reject contradictory known projection coordinates.
Coordinate editing checks the complete requested state, including linked stations,
locked dependencies and collapsed edges, before committing. The current
constraint tolerance is `1e-6 mm`, separate from screen selection tolerances.
A side-depth check requires the drawing's side mapping.

`renamePoint` defaults to `{renameScope: 'local', labelPolicy: 'allow'}`.
Callers may request `renameScope: 'linked'`, `memberId`, or
`labelPolicy: 'unique-view'`. `editPoint` also supports `moveScope: 'linked'` or
`'detach'` and `labelAction: 'members'`. Unknown rule values are rejected.
`assignMembers`, `linkPoints`, and `detachPoint` are explicit operations.

Failed compound edits do not alter the live table. Successful batch updates publish
completed state to subscribers. Save/load preserves member IDs; malformed member
records and conflicting shared names reject before the destination is cleared.
Undo/redo restores identity metadata together with the geometry.

## Compatibility and scope

`table.create('POINT', ...)` creates independent identities. Importing a whole
legacy drawing is a separate operation: `table.importEntities(rows)` captures
unambiguous legacy caption correspondences once. Repeated legacy names in the
same view are treated as ambiguous and receive separate IDs. The import validates
the full batch before publishing it. Demos use this path.

Raw legacy records without `meta.members` remain readable. The editing boundary
captures their identities before mutation; reconstruction has a pure compatibility
adapter. Save format version 1 already preserves arbitrary metadata, so it does
not need a destructive format conversion. Existing corrupt captions cannot be
recovered automatically; restart a tutorial or reassign its members explicitly.

The reconstruction reader consumes canonical member IDs through an adapter;
lesson checking consumes declared member names and hidden verdicts. Display-only
renames cannot change either input. The tutorial's historical `rename` script
steps are station-assignment actions, not display-label edits.

Geometric inference for shapes, approximate numerical reconstruction, and legacy
unowned endpoints still exist. This change does not prove every subsystem correct
or replace all geometric inference with a fully constrained CAD solver.

## Verification

Draw the affected identity case as an EduCAD Script sheet and validate it
headlessly:

```sh
node tools/edc.js --solid tools/scripts/rule-a.edc
```

The script draws the stations, the runner reports per-line errors and projector
alignment, and the `--solid` dump shows the lifted 3D result. Use the same
pattern for linked rename, detach or station-assignment cases.
