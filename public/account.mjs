import {supabasePublishableKey, supabaseUrl} from './supabase-config.mjs';
import {libraryFromRecords, libraryRecords, queueChanges} from './sync.mjs';

const $ = id => document.getElementById(id);
const guestMode = 'jazz-legacy.mode';
const profileKey = id => 'jazz-legacy.profile.' + id;
const importedKey = 'jazz-legacy.guest-imported';
const status = message => { $('account-status').textContent = message; };

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function write(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

export function setupAccount(library, renderPlayer) {
  const client = supabaseUrl && supabasePublishableKey && window.supabase?.createClient(supabaseUrl, supabasePublishableKey, {
    auth: {flowType: 'pkce', detectSessionInUrl: true},
  });
  let profile;
  let session;
  let timer;
  let busy = false;
  let again = false;
  let accountMode;
  let initialized = false;
  let cookieUpdate = Promise.resolve();

  function apply() {
    const data = profile ? libraryFromRecords(profile.records) : {...library.guestState(), mode: read(guestMode)};
    accountMode = data.mode;
    library.setState(data, !profile);
    renderPlayer();
  }

  function switchAccount(next) {
    const same = initialized && session?.user.id === next?.user.id;
    initialized = true;
    session = next;
    if (same) return;
    clearTimeout(timer);
    profile = next ? read(profileKey(next.user.id), {records: {}, pending: {}}) : null;
    $('account-connected').hidden = !next;
    $('account-guest').hidden = Boolean(next);
    $('account-identity').textContent = next?.user.email ?? '';
    $('account-button').textContent = next ? 'Compte connecté' : 'Mon compte';
    apply();
    return profile ? sync() : undefined;
  }

  function schedule(delay = 350) {
    clearTimeout(timer);
    timer = setTimeout(sync, delay);
  }

  async function sync() {
    if (!client || !session || !profile || !navigator.onLine) return;
    if (busy) { again = true; return; }
    busy = true;
    const userId = session.user.id;
    const target = profile;
    const active = () => profile === target && session?.user.id === userId;
    const persist = () => write(profileKey(userId), target);
    try {
      const remote = Object.create(null);
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const {data, error} = await client.from('library_entries').select('id,value')
          .eq('user_id', userId).order('id').range(offset, offset + pageSize - 1);
        if (error) throw error;
        if (!active()) return;
        for (const row of data) remote[row.id] = row.value;
        if (data.length < pageSize) break;
      }
      if (!localStorage.getItem(importedKey)) {
        await library.load();
        if (!active()) return;
        const guest = libraryRecords(library.guestState(), read(guestMode));
        for (const [id, value] of Object.entries(guest)) {
          if (Object.hasOwn(remote, id) || Object.hasOwn(target.pending, id)) continue;
          target.pending[id] = {value, id: crypto.randomUUID()};
        }
        for (const [id, change] of Object.entries(target.pending)) target.records[id] = change.value;
        persist();
        localStorage.setItem(importedKey, userId);
      }
      const pending = Object.entries(target.pending);
      for (let start = 0; start < pending.length; start += 200) {
        const batch = pending.slice(start, start + 200);
        const {error} = await client.from('library_entries').upsert(
          batch.map(([id, change]) => ({user_id: userId, id, value: change.value})),
          {onConflict: 'user_id,id'},
        );
        if (error) throw error;
        if (!active()) return;
        for (const [id, change] of batch) {
          remote[id] = change.value;
          if (target.pending[id]?.id === change.id) delete target.pending[id];
        }
        persist();
      }
      for (const [id, change] of Object.entries(target.pending)) remote[id] = change.value;
      target.records = remote;
      persist();
      apply();
      status('Favoris, playlists et préférences synchronisés.');
    } catch {
      if (active()) status('Synchronisation indisponible. Tes changements sont conservés sur cet appareil.');
    } finally {
      busy = false;
      if (again) { again = false; schedule(0); }
    }
  }

  function changed() {
    if (!profile) return;
    const next = libraryRecords(library.state(), accountMode);
    const current = Object.fromEntries(Object.entries(profile.records).filter(([, value]) => value != null));
    queueChanges(current, next, profile.pending);
    profile.records = next;
    write(profileKey(session.user.id), profile);
    schedule();
  }

  function mode(value) {
    if (!value) return profile ? accountMode : read(guestMode);
    if (profile) { accountMode = value; changed(); }
    else write(guestMode, value);
  }

  async function perform(button, work, failure) {
    if (!client || !navigator.onLine) { status('Une connexion Internet est nécessaire.'); return; }
    button.disabled = true;
    status('');
    try { await work(); }
    catch (error) { status(failure(error)); }
    finally { button.disabled = false; }
  }

  const redirectTo = location.origin + '/';
  $('account-button').onclick = () => $('account-dialog').showModal();
  $('account-import').onchange = async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 12000000) throw new Error();
      const backup = JSON.parse(await file.text());
      if (backup.format !== 'jazz-legacy-sites-backup-v1' || !backup.library) throw new Error();
      if (backup.lyrics) {
        if (!session) { status('Connecte-toi pour importer tes paroles personnelles.'); return; }
        let conflicts = 0;
        for (const [id, text] of Object.entries(backup.lyrics)) {
          if (!/^[A-Za-z0-9_:-]{1,160}$/.test(id) || typeof text !== 'string' || text.length > 30000) throw new Error();
          const url = '/api/lyrics/' + encodeURIComponent(id);
          const response = await fetch(url, {cache: 'no-store'});
          if (!response.ok) throw new Error();
          const existing = await response.json();
          if (existing.signIn) throw new Error();
          if (existing.text) { if (existing.text !== text) conflicts++; continue; }
          const written = await fetch(url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text})});
          if (!written.ok) throw new Error();
        }
        status(conflicts ? `Paroles importées. ${conflicts} textes existants ont été conservés.` : 'Paroles personnelles importées.');
        return;
      }
      if (session) {
        status('Déconnecte-toi avant d’importer une bibliothèque stockée sur l’ancien site.');
        return;
      }
      const old = read('heads.catalogue.personal.v1', {});
      const seen = new Set(read('heads.playlists.v1', []).map(playlist => playlist.id));
      const incoming = backup.library;
      const merge = (first, second) => [...new Set([...(first || []), ...(second || [])].filter(value => typeof value === 'string'))];
      const playlists = (backup.playlists || []).filter(playlist => typeof playlist?.id === 'string' &&
        typeof playlist.name === 'string' && Array.isArray(playlist.entries) &&
        playlist.entries.every(entry => typeof entry === 'string') && !seen.has(playlist.id));
      write('heads.catalogue.personal.v1', {...old, favorites: merge(old.favorites, incoming.favorites),
        trackFavorites: merge(old.trackFavorites, incoming.trackFavorites)});
      write('heads.playlists.v1', [...read('heads.playlists.v1', []), ...playlists]);
      if (backup.mode && !read(guestMode)) write(guestMode, backup.mode);
      localStorage.removeItem(importedKey);
      location.reload();
    } catch { status('Ce fichier de sauvegarde est illisible.'); }
    finally { input.value = ''; }
  };
  $('account-google').onclick = event => perform(event.currentTarget, async () => {
    const response = await fetch(supabaseUrl + '/auth/v1/settings', {
      headers: {apikey: supabasePublishableKey},
    });
    if (!response.ok || !(await response.json()).external?.google) throw new Error();
    const {error} = await client.auth.signInWithOAuth({provider: 'google', options: {redirectTo}});
    if (error) throw error;
  }, () => 'La connexion Google est indisponible.');
  $('account-email-form').onsubmit = event => {
    event.preventDefault();
    perform(event.submitter, async () => {
      const email = $('account-email').value.trim();
      const {error} = await client.auth.signInWithOtp({email, options: {emailRedirectTo: redirectTo}});
      if (error) throw error;
      status('Consulte ta boîte e-mail et ouvre le lien sur cet appareil.');
    }, error => error.status === 429
      ? 'Attends avant de demander un autre lien.'
      : 'Impossible d’envoyer le lien de connexion.');
  };
  $('account-sign-out').onclick = event => perform(event.currentTarget, async () => {
    const {error} = await client.auth.signOut({scope: 'local'});
    if (error) throw error;
    status('Compte déconnecté.');
  }, () => 'Impossible de déconnecter le compte.');

  $('account-delete').onclick = event => {
    if (!confirm('Supprimer définitivement ton compte et les données synchronisées ?')) return;
    perform(event.currentTarget, async () => {
      const id = session.user.id;
      const {error} = await client.rpc('delete_my_jazz_account');
      if (error) throw error;
      await client.auth.signOut({scope: 'local'});
      localStorage.removeItem(profileKey(id));
      switchAccount(null);
      status('Compte et données synchronisées supprimés.');
    }, () => 'Impossible de supprimer le compte.');
  };

  const ready = new Promise(resolve => {
    if (!client) { resolve(); return; }
    const timeout = setTimeout(resolve, 1600);
    client.auth.onAuthStateChange((event, next) => {
      if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED'].includes(event)) {
        cookieUpdate = cookieUpdate.then(async () => {
          try { await fetch('/api/session', {method: 'POST', headers: next ? {Authorization: `Bearer ${next.access_token}`} : {}}); }
          catch { /* Audio in the browser remains available when the server is unreachable. */ }
          finally { dispatchEvent(new Event('jazz-session-changed')); }
        });
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        // Leave the auth lock before issuing Data API calls.
        setTimeout(() => {
          Promise.resolve(switchAccount(next)).then(() => {
            clearTimeout(timeout);
            resolve();
          });
        }, 0);
      } else session = next;
    });
  });
  if (location.search.includes('error_description=') || location.hash.includes('error_description=')) {
    status('Le lien de connexion est expiré ou invalide.');
    $('account-dialog').showModal();
  }
  addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
  setInterval(() => { if (!document.hidden) schedule(0); }, 45000);
  return {ready: () => ready, changed, mode};
}
