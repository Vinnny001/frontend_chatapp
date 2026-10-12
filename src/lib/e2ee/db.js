// This device's end-to-end encryption store (IndexedDB, one database per signed-in device):
//   kv      identity key pair, pinned public keys of other devices, flags
//   kps     private halves of the KeyPackages this device published
//   groups  MLS group state of each chat (encoded), with a little metadata
//   plain   decrypted messages: a message can be decrypted only once (its key is deleted
//           afterwards, which is what keeps old messages safe), so the result is kept here.

const STORES = ['kv', 'kps', 'groups', 'plain'];

export const dbName = (userId, deviceId) => `chatapp-e2ee-${userId}-${deviceId}`;

export function openDb(name) {
  return new Promise((resolve, reject) => {
    // Never wait forever (e.g. another ChatApp tab holding the database, storage switched off).
    const timer = setTimeout(() => reject(new Error('The browser’s storage didn’t open (another ChatApp tab may be holding it)')), 10_000);
    let req;
    try {
      req = indexedDB.open(name, 1);
    } catch (err) {
      clearTimeout(timer);
      return reject(err);
    }
    req.onupgradeneeded = () => STORES.forEach((s) => req.result.objectStoreNames.contains(s) || req.result.createObjectStore(s));
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(wrap(req.result));
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error || new Error('The browser’s storage refused to open'));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('Another ChatApp tab is holding the browser’s storage: close the other tabs and retry'));
    };
  });
}

function wrap(db) {
  const run = (store, mode, fn) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  return {
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key)),
    del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    /** Every [key, value] of a store. */
    entries: (store) =>
      new Promise((resolve, reject) => {
        const out = [];
        const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve(out);
          out.push([c.key, c.value]);
          c.continue();
        };
        req.onerror = () => reject(req.error);
      }),
    close: () => db.close(),
  };
}

export function deleteDb(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
