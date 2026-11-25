export function offlineAudio() {
  let database;

  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('jazz-legacy-audio', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recordings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return database;
  }

  async function run(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', mode);
      const request = work(tx.objectStore('recordings'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    keys: () => run('readonly', store => store.getAllKeys()),
    get: id => run('readonly', store => store.get(id)),
    put: (id, file) => run('readwrite', store => store.put(file, id)),
    remove: id => run('readwrite', store => store.delete(id)),
  };
}
