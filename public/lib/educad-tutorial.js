(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADTutorial = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD scripted-user tutorials: stepwise lessons that draw through the
  // page's own user-action functions (place, select, rename, anchor, lock,
  // BIS pick) instead of injecting entities. Each step pairs one action
  // with its explanation. The engine below is pure navigation + script
  // validation; the page executes actions and resolves '@N' refs (placed
  // points in creation order) to live ids. Zero deps. Dual-env: browser
  // via window.EduCADTutorial, plain Node via module.exports. Node-safe.
  var WORLD_UNITS = 'mm';
  var VERSION = '1.1.0-educad';
  // Mirrors the line tool's offered BIS codes (canvas stays the owner).
  var STEP_BIS_CODES = ['A', 'B', 'E', 'G', 'K'];
  var STEP_OPS = ['setup', 'place', 'rename', 'anchor', 'lock', 'type', 'check'];

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function isRef(s) {
    return typeof s === 'string' && /^@[1-9][0-9]*$/.test(s);
  }

  // Profile Square in 32 steps: furniture, four corner dots, shared
  // edge-on outlines (drawn BEFORE naming, so no member claim attaches
  // to shared ink), neutral pair names, one declared projector per
  // corner, paren verdicts, then Check. Coordinates match profileSquare
  // (40 mm at x = 0); captions match its stations.
  var SQUARE_SCRIPT = [
    { say: 'Fresh sheet with the XY ground line. The datum is furniture — everything else you draw.',
      do: { op: 'setup' } },
    { say: 'Place the VP top corner: a dot at X 0, Y 40.',
      do: { op: 'place', x: 0, y: 40 } },
    { say: 'Place the VP bottom corner on the ground line (Y 0).',
      do: { op: 'place', x: 0, y: 0 } },
    { say: 'Place the HP near foot below XY (Y −8).',
      do: { op: 'place', x: 0, y: -8 } },
    { say: 'Place the HP far foot (Y −48).',
      do: { op: 'place', x: 0, y: -48 } },
    { say: 'Ctrl+click the top dot: the line anchors (one name, so no claim yet).',
      do: { op: 'anchor', ref: '@1', member: null } },
    { say: 'Click the bottom dot: P2 locks and the line-type popup opens.',
      do: { op: 'lock', ref: '@2' } },
    { say: 'Pick Type A: the edge-on elevation draws itself.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the near foot for the plan edge.',
      do: { op: 'anchor', ref: '@3', member: null } },
    { say: 'Lock the far foot.',
      do: { op: 'lock', ref: '@4' } },
    { say: 'Pick Type A: the edge-on plan draws itself.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Name the VP top station for its two corners, visible first.',
      do: { op: 'rename', ref: '@1', name: "b',a'" } },
    { say: 'Name the VP bottom station.',
      do: { op: 'rename', ref: '@2', name: "c',d'" } },
    { say: 'Name the near foot.',
      do: { op: 'rename', ref: '@3', name: 'a,d' } },
    { say: 'Name the far foot.',
      do: { op: 'rename', ref: '@4', name: 'b,c' } },
    { say: 'Corner a: anchor the VP top and declare member a.',
      do: { op: 'anchor', ref: '@1', member: 'a' } },
    { say: 'Draw to the foot you claim is its mate: the near foot.',
      do: { op: 'lock', ref: '@3' } },
    { say: 'Type G projector. It crosses XY, so 3D ignores it — it is your answer, not geometry.',
      do: { op: 'type', bis: 'G' } },
    { say: 'Corner b: same station, declare b.',
      do: { op: 'anchor', ref: '@1', member: 'b' } },
    { say: 'Its mate is the far foot.',
      do: { op: 'lock', ref: '@4' } },
    { say: 'Type G.',
      do: { op: 'type', bis: 'G' } },
    { say: 'Corner c: anchor the VP bottom, declare c.',
      do: { op: 'anchor', ref: '@2', member: 'c' } },
    { say: 'To the far foot.',
      do: { op: 'lock', ref: '@4' } },
    { say: 'Type G.',
      do: { op: 'type', bis: 'G' } },
    { say: 'Corner d: same station, declare d.',
      do: { op: 'anchor', ref: '@2', member: 'd' } },
    { say: 'To the near foot.',
      do: { op: 'lock', ref: '@3' } },
    { say: 'Type G.',
      do: { op: 'type', bis: 'G' } },
    { say: 'Verdict: at the VP top, the back corner hides — judge it from the plan depths.',
      do: { op: 'rename', ref: '@1', name: "b',(a')" } },
    { say: 'Same question at the VP bottom.',
      do: { op: 'rename', ref: '@2', name: "c',(d')" } },
    { say: 'In plan the bottom corner hides — judge it from the elevation heights.',
      do: { op: 'rename', ref: '@3', name: 'a,(d)' } },
    { say: 'Same question at the far foot.',
      do: { op: 'rename', ref: '@4', name: 'b,(c)' } },
    { say: 'Done drawing. Pressing Check hidden grades every verdict and claim.',
      do: { op: 'check' } }
  ];

  // Hexagonal prism in 88 steps: the honest solid. Six plan dots around
  // a flat-top hexagon (back edge nearest XY, front edge deepest), eight
  // elevation dots (four lone silhouette corners, four stacked front+back
  // pairs), shared ink BEFORE naming, four full-height unclaimed projectors (geometry
  // pairs every corner here, so no member claim is needed — the square's
  // claims were its rescue, not a ritual), neutral pair names, paren
  // verdicts, then Check. Coordinates match regularSolid PRISM (35 mm
  // across corners, 70 mm tall, centred x = 0); captions match its
  // stations. @1..@6 plan v0..v5, @7..@14 elevation.
  var PRISM_SCRIPT = [
    { say: 'Fresh sheet with the XY ground line. You are drawing a 35 mm hexagonal prism, 70 mm tall.',
      do: { op: 'setup' } },
    { say: 'Place the plan right corner: X 17.5, Y −25.5 — the hexagon corner pointing right.',
      do: { op: 'place', x: 17.5, y: -25.5 } },
    { say: 'Place the back-right plan corner (X 8.75, Y −10.34) — nearest the XY line is the back edge.',
      do: { op: 'place', x: 8.75, y: -10.344555 } },
    { say: 'Place the back-left plan corner (X −8.75, Y −10.34).',
      do: { op: 'place', x: -8.75, y: -10.344555 } },
    { say: 'Place the plan left corner: X −17.5, Y −25.5 — the corner pointing left.',
      do: { op: 'place', x: -17.5, y: -25.5 } },
    { say: 'Place the front-left plan corner (X −8.75, Y −40.66) — deepest below XY is the front edge.',
      do: { op: 'place', x: -8.75, y: -40.655445 } },
    { say: 'Place the front-right plan corner (X 8.75, Y −40.66).',
      do: { op: 'place', x: 8.75, y: -40.655445 } },
    { say: 'Place the VP right-bottom corner: on the ground line (Y 0), straight above the plan right corner.',
      do: { op: 'place', x: 17.5, y: 0 } },
    { say: 'Place the VP right-top corner (Y 70) — the prism stands 70 mm tall.',
      do: { op: 'place', x: 17.5, y: 70 } },
    { say: 'Place the VP left-bottom corner (X −17.5, Y 0).',
      do: { op: 'place', x: -17.5, y: 0 } },
    { say: 'Place the VP left-top corner (X −17.5, Y 70).',
      do: { op: 'place', x: -17.5, y: 70 } },
    { say: 'Place the VP inner-right bottom station (X 8.75, Y 0) — front and back corners stack here.',
      do: { op: 'place', x: 8.75, y: 0 } },
    { say: 'Place the VP inner-right top station (X 8.75, Y 70).',
      do: { op: 'place', x: 8.75, y: 70 } },
    { say: 'Place the VP inner-left bottom station (X −8.75, Y 0).',
      do: { op: 'place', x: -8.75, y: 0 } },
    { say: 'Place the VP inner-left top station (X −8.75, Y 70).',
      do: { op: 'place', x: -8.75, y: 70 } },
    { say: 'Anchor the right corner: the first hexagon edge starts here.',
      do: { op: 'anchor', ref: '@1', member: null } },
    { say: 'Lock the back-right corner.',
      do: { op: 'lock', ref: '@2' } },
    { say: 'Pick Type A: the back-right slant draws itself.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the back-right corner for the back edge.',
      do: { op: 'anchor', ref: '@2', member: null } },
    { say: 'Lock the back-left corner.',
      do: { op: 'lock', ref: '@3' } },
    { say: 'Pick Type A: the back edge (nearest XY) draws itself.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the back-left corner.',
      do: { op: 'anchor', ref: '@3', member: null } },
    { say: 'Lock the left corner.',
      do: { op: 'lock', ref: '@4' } },
    { say: 'Pick Type A: the back-left slant draws itself.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the left corner.',
      do: { op: 'anchor', ref: '@4', member: null } },
    { say: 'Lock the front-left corner.',
      do: { op: 'lock', ref: '@5' } },
    { say: 'Pick Type A: the front-left slant draws itself.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the front-left corner for the front edge.',
      do: { op: 'anchor', ref: '@5', member: null } },
    { say: 'Lock the front-right corner.',
      do: { op: 'lock', ref: '@6' } },
    { say: 'Pick Type A: the front edge (deepest below XY) draws itself.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the front-right corner to close the hexagon.',
      do: { op: 'anchor', ref: '@6', member: null } },
    { say: 'Lock the right corner.',
      do: { op: 'lock', ref: '@1' } },
    { say: 'Pick Type A: the hexagon closes. Six edges, six corner dots.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Elevation next. Anchor the right-bottom corner for the base edge.',
      do: { op: 'anchor', ref: '@7', member: null } },
    { say: 'Lock the left-bottom corner.',
      do: { op: 'lock', ref: '@9' } },
    { say: 'Pick Type A: the base edge draws itself along the ground line.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the left-bottom corner for the left silhouette.',
      do: { op: 'anchor', ref: '@9', member: null } },
    { say: 'Lock the left-top corner.',
      do: { op: 'lock', ref: '@10' } },
    { say: 'Pick Type A: the left silhouette rises.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the left-top corner for the top edge.',
      do: { op: 'anchor', ref: '@10', member: null } },
    { say: 'Lock the right-top corner.',
      do: { op: 'lock', ref: '@8' } },
    { say: 'Pick Type A: the top edge draws itself.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the right-top corner for the right silhouette.',
      do: { op: 'anchor', ref: '@8', member: null } },
    { say: 'Lock the right-bottom corner.',
      do: { op: 'lock', ref: '@7' } },
    { say: 'Pick Type A: the 35x70 rectangle closes.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the inner-left bottom station: a facet vertical stands here.',
      do: { op: 'anchor', ref: '@13', member: null } },
    { say: 'Lock the inner-left top station.',
      do: { op: 'lock', ref: '@14' } },
    { say: "Pick Type A: the left facet edge — one line for the coincident front+back pair.",
      do: { op: 'type', bis: 'A' } },
    { say: 'Anchor the inner-right bottom station.',
      do: { op: 'anchor', ref: '@11', member: null } },
    { say: 'Lock the inner-right top station.',
      do: { op: 'lock', ref: '@12' } },
    { say: 'Pick Type A: the right facet edge. Ink done — drawn before naming, so no claim stuck to shared lines.',
      do: { op: 'type', bis: 'A' } },
    { say: 'Projection discipline: anchor the plan right corner.',
      do: { op: 'anchor', ref: '@1', member: null } },
    { say: 'Lock the VP right-top corner — the projector spans the full station height.',
      do: { op: 'lock', ref: '@8' } },
    { say: 'Type G projector. It crosses XY, so 3D ignores it — alignment ink, not geometry.',
      do: { op: 'type', bis: 'G' } },
    { say: 'Anchor the plan left corner.',
      do: { op: 'anchor', ref: '@4', member: null } },
    { say: 'Lock the VP left-top corner.',
      do: { op: 'lock', ref: '@10' } },
    { say: 'Type G.',
      do: { op: 'type', bis: 'G' } },
    { say: 'Anchor the front-right plan corner (X 8.75).',
      do: { op: 'anchor', ref: '@6', member: null } },
    { say: "Lock the inner-right top station — l' projects straight down to the l,f corner.",
      do: { op: 'lock', ref: '@12' } },
    { say: 'Type G.',
      do: { op: 'type', bis: 'G' } },
    { say: 'Anchor the front-left plan corner (X −8.75).',
      do: { op: 'anchor', ref: '@5', member: null } },
    { say: "Lock the inner-left top station — k' projects straight down to the k,e corner.",
      do: { op: 'lock', ref: '@14' } },
    { say: 'Type G. Four full-height projectors — every dot sits on one — unclaimed, because here geometry pairs every corner itself.',
      do: { op: 'type', bis: 'G' } },
    { say: 'Name the right plan corner for its two corners, top first: g,a.',
      do: { op: 'rename', ref: '@1', name: 'g,a' } },
    { say: 'Name the back-right plan corner: h,b.',
      do: { op: 'rename', ref: '@2', name: 'h,b' } },
    { say: 'Name the back-left plan corner: i,c.',
      do: { op: 'rename', ref: '@3', name: 'i,c' } },
    { say: 'Name the left plan corner: j,d.',
      do: { op: 'rename', ref: '@4', name: 'j,d' } },
    { say: 'Name the front-left plan corner: k,e.',
      do: { op: 'rename', ref: '@5', name: 'k,e' } },
    { say: 'Name the front-right plan corner: l,f.',
      do: { op: 'rename', ref: '@6', name: 'l,f' } },
    { say: "Name the VP right-bottom station: a' — a lone silhouette corner.",
      do: { op: 'rename', ref: '@7', name: "a'" } },
    { say: "Name the VP right-top station: g'.",
      do: { op: 'rename', ref: '@8', name: "g'" } },
    { say: "Name the VP left-bottom station: d'.",
      do: { op: 'rename', ref: '@9', name: "d'" } },
    { say: "Name the VP left-top station: j'.",
      do: { op: 'rename', ref: '@10', name: "j'" } },
    { say: "Name the inner-right bottom station, front first: f',b'.",
      do: { op: 'rename', ref: '@11', name: "f',b'" } },
    { say: "Name the inner-right top station: l',h'.",
      do: { op: 'rename', ref: '@12', name: "l',h'" } },
    { say: "Name the inner-left bottom station: e',c'.",
      do: { op: 'rename', ref: '@13', name: "e',c'" } },
    { say: "Name the inner-left top station: k',i'. Names complete — look at the 3D glass: the prism built itself.",
      do: { op: 'rename', ref: '@14', name: "k',i'" } },
    { say: 'Verdict: looking from above, the top face covers the bottom — the bottom corner hides. Judge it: g,(a).',
      do: { op: 'rename', ref: '@1', name: 'g,(a)' } },
    { say: 'Same question at the back-right plan corner: h,(b).',
      do: { op: 'rename', ref: '@2', name: 'h,(b)' } },
    { say: 'At the back-left plan corner: i,(c).',
      do: { op: 'rename', ref: '@3', name: 'i,(c)' } },
    { say: 'At the left plan corner: j,(d).',
      do: { op: 'rename', ref: '@4', name: 'j,(d)' } },
    { say: 'At the front-left plan corner: k,(e).',
      do: { op: 'rename', ref: '@5', name: 'k,(e)' } },
    { say: 'At the front-right plan corner: l,(f).',
      do: { op: 'rename', ref: '@6', name: 'l,(f)' } },
    { say: "In elevation the front corner covers the back one — judge the inner-right bottom: f',(b').",
      do: { op: 'rename', ref: '@11', name: "f',(b')" } },
    { say: "Same question at the inner-right top: l',(h').",
      do: { op: 'rename', ref: '@12', name: "l',(h')" } },
    { say: "At the inner-left bottom: e',(c').",
      do: { op: 'rename', ref: '@13', name: "e',(c')" } },
    { say: "At the inner-left top: k',(i'). The four lone silhouette corners stay bare — always visible.",
      do: { op: 'rename', ref: '@14', name: "k',(i')" } },
    { say: 'Done drawing. Pressing Check hidden grades all 14 stations and 4 projectors.',
      do: { op: 'check' } }
  ];

  // validateScript(script): every step needs a non-empty saying and a
  // well-formed action; refs must point at dots placed by earlier steps.
  // Returns {ok, errors[]} — never throws on script shape.
  function validateScript(script) {
    var errors = [];
    if (!Array.isArray(script)) return { ok: false, errors: ['script must be an array'] };
    var placed = 0;
    for (var i = 0; i < script.length; i++) {
      var tag = 'step ' + (i + 1);
      var st = script[i];
      if (!st || typeof st !== 'object') { errors.push(tag + ': not an object'); continue; }
      if (typeof st.say !== 'string' || st.say.replace(/^\s+|\s+$/g, '') === '') {
        errors.push(tag + ': empty saying');
      }
      var a = st.do;
      if (!a || typeof a !== 'object') { errors.push(tag + ': missing action'); continue; }
      if (STEP_OPS.indexOf(a.op) === -1) { errors.push(tag + ': unknown op ' + String(a.op)); continue; }
      if (a.op === 'place') {
        placed++;
        if (typeof a.x !== 'number' || Number.isNaN(a.x) || !Number.isFinite(a.x) ||
            typeof a.y !== 'number' || Number.isNaN(a.y) || !Number.isFinite(a.y)) {
          errors.push(tag + ': place needs finite x/y');
        }
      } else if (a.op === 'rename') {
        if (!isRef(a.ref)) errors.push(tag + ': rename needs a @N ref');
        else if (Number(a.ref.slice(1)) > placed) errors.push(tag + ': ref before its place');
        if (typeof a.name !== 'string' || a.name === '') errors.push(tag + ': rename needs a name');
      } else if (a.op === 'anchor') {
        if (!isRef(a.ref)) errors.push(tag + ': anchor needs a @N ref');
        else if (Number(a.ref.slice(1)) > placed) errors.push(tag + ': ref before its place');
        if (a.member !== null && a.member !== undefined && typeof a.member !== 'string') {
          errors.push(tag + ': member must be a string or null');
        }
      } else if (a.op === 'lock') {
        if (!isRef(a.ref)) errors.push(tag + ': lock needs a @N ref');
        else if (Number(a.ref.slice(1)) > placed) errors.push(tag + ': ref before its place');
      } else if (a.op === 'type') {
        if (STEP_BIS_CODES.indexOf(a.bis) === -1) {
          errors.push(tag + ': unknown BIS ' + String(a.bis));
        }
      }
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function createStepper(script) {
    if (!Array.isArray(script)) throw new Error('script must be an array');
    return { script: script, i: 0 };
  }

  function total(st) { return st.script.length; }
  function done(st) { return st.i >= st.script.length; }
  function current(st) {
    if (done(st)) return null;
    return st.script[st.i];
  }

  function advance(st) {
    if (st.i < st.script.length) st.i++;
    return st;
  }

  function back(st) {
    if (st.i > 0) st.i--;
    return st;
  }

  function restart(st) {
    st.i = 0;
    return st;
  }

  return {
    WORLD_UNITS: WORLD_UNITS, VERSION: VERSION,
    STEP_OPS: STEP_OPS, STEP_BIS_CODES: STEP_BIS_CODES,
    SQUARE_SCRIPT: SQUARE_SCRIPT, PRISM_SCRIPT: PRISM_SCRIPT,
    validateScript: validateScript,
    createStepper: createStepper, total: total, done: done,
    current: current, advance: advance, back: back, restart: restart
  };
});
