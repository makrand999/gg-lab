(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADSaves = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD drawing saves + progress client. DOM-free: the browser UI lives
  // in index.html; this module only snapshots/restores entity tables and
  // speaks the /api/* JSON endpoints. Guests never touch the server.
  var SAVE_VERSION = 1;
  var SESSION_KEY = 'educad_session';

  function defaultStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    } catch (err) { /* blocked storage */ }
    return null;
  }

  function defaultFetch() {
    if (typeof fetch === 'function') return fetch;
    try {
      if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        return window.fetch.bind(window);
      }
    } catch (err) { /* no fetch */ }
    return null;
  }

  // Session kept by login.js: {role, username, name, token}. Guests carry
  // role 'guest' with a dummy token and must stay server-free.
  function currentSession(storage) {
    var store = (storage === undefined) ? defaultStorage() : storage;
    if (!store) return null;
    try {
      var raw = store.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && typeof s === 'object') ? s : null;
    } catch (err) {
      return null;
    }
  }

  function isGuest(session) {
    return !session || session.role === 'guest' ||
      typeof session.token !== 'string' || !session.token ||
      session.token === 'guest';
  }

  // Deep JSON snapshot of every entity in table order. The round-trip
  // detaches the payload from live table objects (later edits cannot
  // corrupt an in-flight save) and drops non-JSON values.
  function snapshotTable(table) {
    if (!table || typeof table.list !== 'function') {
      throw new Error('saves: snapshot needs an entity table');
    }
    var snap = { version: SAVE_VERSION, savedAt: Date.now(), entities: table.list() };
    return JSON.parse(JSON.stringify(snap));
  }

  // Atomically replace the table with a snapshot: every entity is built
  // (and validated by E.createEntity) BEFORE the table is touched, so a
  // malformed payload throws with the live sheet unchanged. Returns count.
  function restoreTable(E, table, data) {
    if (!E || typeof E.createEntity !== 'function' || !Array.isArray(E.ENTITY_TYPES)) {
      throw new Error('saves: restore needs the entities module');
    }
    if (!table || typeof table.clear !== 'function' || typeof table.add !== 'function') {
      throw new Error('saves: restore needs an entity table');
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.entities)) {
      throw new Error('saves: snapshot needs an entities array');
    }
    var seen = {};
    var built = data.entities.map(function (raw, i) {
      if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
        throw new Error('saves: entity ' + i + ' is malformed');
      }
      if (E.ENTITY_TYPES.indexOf(raw.type) === -1) {
        throw new Error('saves: entity ' + i + ' has unknown type ' + raw.type);
      }
      var e = E.createEntity(raw.type, raw);
      if (seen[e.id]) throw new Error('saves: duplicate entity id ' + e.id);
      seen[e.id] = true;
      return e;
    });
    table.clear();
    built.forEach(function (e) { table.add(e); });
    return built.length;
  }

  // API paths are mount-relative (no leading slash) so the same code
  // works on a root-mounted dev server (/api/…) and under a sub-path
  // mount (/major/api/…). Callers must pass relative paths too.
  // Thin fetch wrapper: bearer auth, JSON in/out, Error(status) on failure.
  function apiRequest(fetchImpl, method, path, session, body) {
    if (typeof fetchImpl !== 'function') {
      return Promise.reject(new Error('saves: fetch unavailable'));
    }
    if (isGuest(session)) {
      return Promise.reject(new Error('saves: guest has no server access'));
    }
    var init = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.token
      }
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetchImpl(path, init).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data || data.ok !== true) {
          var msg = (data && data.error) || ('request failed: ' + res.status);
          var err = new Error(String(msg));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function listDrawings(fetchImpl, session) {
    return apiRequest(fetchImpl, 'GET', 'api/drawings', session);
  }
  function createDrawing(fetchImpl, session, title, data) {
    return apiRequest(fetchImpl, 'POST', 'api/drawings', session,
      { title: title, data: data });
  }
  function getDrawing(fetchImpl, session, id) {
    return apiRequest(fetchImpl, 'GET', 'api/drawings/' + id, session);
  }
  function updateDrawing(fetchImpl, session, id, patch) {
    return apiRequest(fetchImpl, 'PUT', 'api/drawings/' + id, session, patch);
  }
  function deleteDrawing(fetchImpl, session, id) {
    return apiRequest(fetchImpl, 'DELETE', 'api/drawings/' + id, session);
  }
  function listSets(fetchImpl, session) {
    return apiRequest(fetchImpl, 'GET', 'api/sets', session);
  }
  function createSet(fetchImpl, session, code, title, questions, classCode) {
    var body = { code: code, title: title, questions: questions };
    if (classCode) body.class_code = classCode;
    return apiRequest(fetchImpl, 'POST', 'api/sets', session, body);
  }
  function listClasses(fetchImpl, session) {
    return apiRequest(fetchImpl, 'GET', 'api/classes', session);
  }
  function createClass(fetchImpl, session, code, title) {
    return apiRequest(fetchImpl, 'POST', 'api/classes', session,
      { code: code, title: title });
  }
  function getClass(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'GET', 'api/classes/' + code, session);
  }
  function deleteClass(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'DELETE', 'api/classes/' + code, session);
  }
  function joinClass(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'POST', 'api/classes/' + code + '/join', session, {});
  }
  function leaveClass(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'POST', 'api/classes/' + code + '/leave', session, {});
  }
  function listMembers(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'GET', 'api/classes/' + code + '/members', session);
  }
  function listClassSets(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'GET', 'api/classes/' + code + '/sets', session);
  }
  function getSet(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'GET', 'api/sets/' + code, session);
  }
  function deleteSet(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'DELETE', 'api/sets/' + code, session);
  }
  function submitSolution(fetchImpl, session, code, questionIndex, data, note) {
    return apiRequest(fetchImpl, 'POST', 'api/sets/' + code + '/submissions', session,
      { question_index: questionIndex, data: data, note: note });
  }
  function verifySolution(fetchImpl, session, code, questionIndex, data) {
    return apiRequest(fetchImpl, 'POST', 'api/sets/' + code + '/verify', session,
      { question_index: questionIndex, data: data });
  }
  function setQuestionModel(fetchImpl, session, code, qi, data) {
    return apiRequest(fetchImpl, 'PUT',
      'api/sets/' + code + '/questions/' + qi + '/model', session, { data: data });
  }
  function clearQuestionModel(fetchImpl, session, code, qi) {
    return apiRequest(fetchImpl, 'DELETE',
      'api/sets/' + code + '/questions/' + qi + '/model', session);
  }
  function setQuestionCheck(fetchImpl, session, code, qi, enabled) {
    return apiRequest(fetchImpl, 'PUT',
      'api/sets/' + code + '/questions/' + qi + '/check', session,
      { enabled: !!enabled });
  }
  function interpretWords(fetchImpl, session, text, points, mode) {
    return apiRequest(fetchImpl, 'POST', 'api/interpret', session,
      { text: text, points: points || [], mode: mode || 'draw' });
  }
  function gradeSubmission(fetchImpl, session, id, verdict, remarks) {
    return apiRequest(fetchImpl, 'PUT', 'api/submissions/' + id + '/grade', session,
      { verdict: verdict, remarks: remarks });
  }
  function listSubmissions(fetchImpl, session, code) {
    return apiRequest(fetchImpl, 'GET', 'api/sets/' + code + '/submissions', session);
  }
  function getSubmission(fetchImpl, session, id) {
    return apiRequest(fetchImpl, 'GET', 'api/submissions/' + id, session);
  }
  function listMySubmissions(fetchImpl, session) {
    return apiRequest(fetchImpl, 'GET', 'api/submissions/mine', session);
  }
  function listProgress(fetchImpl, session) {
    return apiRequest(fetchImpl, 'GET', 'api/progress', session);
  }
  function putProgress(fetchImpl, session, lesson, state) {
    return apiRequest(fetchImpl, 'PUT', 'api/progress/' + lesson, session,
      { state: state });
  }

  // Fire-and-forget glue for the app shell: resolves {skipped:true} for
  // guests or when fetch/storage is unavailable instead of rejecting.
  // deps ({fetch, storage}) is injectable for tests; browser uses globals.
  function recordProgress(lesson, state, deps) {
    var d = deps || {};
    var store = (d.storage === undefined) ? defaultStorage() : d.storage;
    var session = currentSession(store);
    if (isGuest(session)) return Promise.resolve({ ok: true, skipped: true });
    var fi = (d.fetch === undefined) ? defaultFetch() : d.fetch;
    if (typeof fi !== 'function') return Promise.resolve({ ok: true, skipped: true });
    return putProgress(fi, session, lesson, state).then(function (data) {
      return { ok: true, skipped: false, lesson: data.lesson };
    });
  }

  function fetchProgress(deps) {
    var d = deps || {};
    var store = (d.storage === undefined) ? defaultStorage() : d.storage;
    var session = currentSession(store);
    if (isGuest(session)) return Promise.resolve({ ok: true, skipped: true, progress: [] });
    var fi = (d.fetch === undefined) ? defaultFetch() : d.fetch;
    if (typeof fi !== 'function') {
      return Promise.resolve({ ok: true, skipped: true, progress: [] });
    }
    return listProgress(fi, session).then(function (data) {
      return { ok: true, skipped: false, progress: data.progress || [] };
    });
  }

  return {
    SAVE_VERSION: SAVE_VERSION, SESSION_KEY: SESSION_KEY,
    currentSession: currentSession, isGuest: isGuest,
    snapshotTable: snapshotTable, restoreTable: restoreTable,
    apiRequest: apiRequest,
    listDrawings: listDrawings, createDrawing: createDrawing,
    getDrawing: getDrawing, updateDrawing: updateDrawing,
    deleteDrawing: deleteDrawing,
    listSets: listSets, createSet: createSet, getSet: getSet,
    deleteSet: deleteSet,
    listClasses: listClasses, createClass: createClass, getClass: getClass,
    deleteClass: deleteClass, joinClass: joinClass, leaveClass: leaveClass,
    listMembers: listMembers, listClassSets: listClassSets,
    submitSolution: submitSolution, verifySolution: verifySolution,
    setQuestionModel: setQuestionModel, clearQuestionModel: clearQuestionModel,
    setQuestionCheck: setQuestionCheck, gradeSubmission: gradeSubmission,
    listSubmissions: listSubmissions, getSubmission: getSubmission,
    listMySubmissions: listMySubmissions,
    listProgress: listProgress, putProgress: putProgress,
    recordProgress: recordProgress, fetchProgress: fetchProgress,
    interpretWords: interpretWords
  };
});
