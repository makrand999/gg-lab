(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADLocalDrawings = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DB_NAME = 'educad-local-drawings';
  var DB_VERSION = 1;
  var STORE = 'drawings';

  function storageError(message) {
    return new Error(message || 'Browser drawing storage is unavailable.');
  }

  function indexedDb() {
    try {
      return (typeof indexedDB !== 'undefined' && indexedDB) ? indexedDB : null;
    } catch (err) {
      return null;
    }
  }

  var opening = null;

  function open() {
    if (opening) return opening;
    var idb = indexedDb();
    if (!idb) return Promise.reject(storageError());
    opening = new Promise(function (resolve, reject) {
      var request;
      try {
        request = idb.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(storageError(err && err.message));
        return;
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (db.objectStoreNames.contains(STORE)) return;
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      request.onsuccess = function () {
        var db = request.result;
        db.onversionchange = function () {
          try { db.close(); } catch (err) {}
          opening = null;
        };
        resolve(db);
      };
      request.onerror = function () {
        reject(storageError(request.error && request.error.message));
      };
      request.onblocked = function () {
        reject(storageError('Browser drawing storage is blocked by another tab.'));
      };
    });
    opening.then(null, function () { opening = null; });
    return opening;
  }

  function transaction(mode, work) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, store, request, result, settled = false;
        function fail(err) {
          if (settled) return;
          settled = true;
          try { tx.abort(); } catch (e) {}
          reject(err && err.message ? err : storageError(err && String(err)));
        }
        try {
          tx = db.transaction(STORE, mode);
          store = tx.objectStore(STORE);
          request = work(store, function (value) { result = value; }, fail);
        } catch (err) {
          settled = true;
          reject(storageError(err && err.message));
          return;
        }
        if (request) {
          request.onsuccess = function () { result = request.result; };
          request.onerror = function () { fail(request.error); };
        }
        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        tx.onerror = function () { fail(tx.error); };
        tx.onabort = function () {
          fail(tx.error || 'Browser drawing storage cancelled the request.');
        };
      });
    });
  }

  function cleanTitle(title) {
    var value = String(title === undefined || title === null ? '' : title).trim();
    return value || 'Untitled';
  }

  function payload(data) {
    if (!data || typeof data !== 'object') {
      throw storageError('That drawing has no data to store.');
    }
    return JSON.parse(JSON.stringify(data));
  }

  function summary(record) {
    return {
      id: record.id,
      title: record.title || 'Untitled',
      createdAt: record.createdAt || 0,
      updatedAt: record.updatedAt || 0,
      entities: record.data && Array.isArray(record.data.entities) ?
        record.data.entities.length : 0
    };
  }

  function isMissing() {
    return storageError('That saved drawing is no longer in this browser.');
  }

  function list() {
    return transaction('readonly', function (store) {
      return store.getAll();
    }).then(function (records) {
      return (records || []).map(summary).sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    });
  }

  function get(id) {
    return transaction('readonly', function (store) {
      return store.get(id);
    }).then(function (record) {
      if (!record) throw isMissing();
      return {
        id: record.id,
        title: record.title || 'Untitled',
        createdAt: record.createdAt || 0,
        updatedAt: record.updatedAt || 0,
        data: record.data
      };
    });
  }

  function create(title, data) {
    var now = Date.now();
    var record = {
      title: cleanTitle(title),
      data: payload(data),
      createdAt: now,
      updatedAt: now
    };
    return transaction('readwrite', function (store) {
      return store.add(record);
    }).then(function (id) {
      record.id = id;
      return summary(record);
    });
  }

  function update(id, patch) {
    return transaction('readwrite', function (store, done, fail) {
      var data = patch && patch.data !== undefined ? payload(patch.data) : null;
      var lookup = store.get(id);
      lookup.onsuccess = function () {
        var existing = lookup.result;
        if (!existing) { fail(isMissing()); return; }
        var record = {
          id: existing.id,
          title: patch && patch.title !== undefined ?
            cleanTitle(patch.title) : existing.title,
          data: data === null ? existing.data : data,
          createdAt: existing.createdAt,
          updatedAt: Date.now()
        };
        var write = store.put(record);
        write.onsuccess = function () { done(summary(record)); };
        write.onerror = function () { fail(write.error); };
      };
      lookup.onerror = function () { fail(lookup.error); };
    });
  }

  function remove(id) {
    return transaction('readwrite', function (store) {
      return store.delete(id);
    });
  }

  return {
    list: list,
    get: get,
    create: create,
    update: update,
    remove: remove
  };
});
