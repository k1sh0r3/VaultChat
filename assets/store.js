/* VaultChat — IndexedDB persistence. Classic script → globalThis.VaultChat.Store.
   DB "vaultchat", store "documents" (keyPath "id").
   Doc record: { id, name, addedAt, pages, chunker, chunks: [{ text, page, chunkIndex, vec|null }] } */
(function (root) {
  'use strict';

  var DB_NAME = 'vaultchat';
  var DB_VERSION = 1;
  var STORE = 'documents';
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return openDb().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function saveDoc(doc) {
    return tx('readwrite').then(function (s) {
      return new Promise(function (resolve, reject) {
        var r = s.put(doc);
        r.onsuccess = function () { resolve(doc.id); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function listDocs() {
    return tx('readonly').then(function (s) {
      return new Promise(function (resolve, reject) {
        var r = s.getAll();
        r.onsuccess = function () {
          resolve((r.result || []).sort(function (a, b) { return a.addedAt - b.addedAt; }));
        };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function deleteDoc(id) {
    return tx('readwrite').then(function (s) {
      return new Promise(function (resolve, reject) {
        var r = s.delete(id);
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function clearAll() {
    return tx('readwrite').then(function (s) {
      return new Promise(function (resolve, reject) {
        var r = s.clear();
        r.onsuccess = function () { resolve(true); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function newId() {
    return 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  root.VaultChat = root.VaultChat || {};
  root.VaultChat.Store = {
    saveDoc: saveDoc,
    listDocs: listDocs,
    deleteDoc: deleteDoc,
    clearAll: clearAll,
    newId: newId
  };
})(typeof window !== 'undefined' ? window : globalThis);
