const storageKey = 'jazz-legacy.midi';
const directions = {back: -2, forward: 2};
const get = id => document.getElementById(id);

function readBindings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return Object.fromEntries(Object.keys(directions).flatMap(action => {
      const binding = saved?.[action];
      return binding && Number.isInteger(binding.channel) && binding.channel >= 1 && binding.channel <= 16 &&
        Number.isInteger(binding.cc) && binding.cc >= 0 && binding.cc <= 127 ? [[action, binding]] : [];
    }));
  } catch { return {}; }
}

const sameCC = (first, second) => first?.channel === second.channel && first.cc === second.cc;

export function setupMidi(jumpBy) {
  const dialog = get('settings-dialog');
  const enable = get('midi-enable');
  const status = get('midi-status');
  const bindings = readBindings();
  const supported = typeof navigator.requestMIDIAccess === 'function';
  const inputs = new Set();
  let access;
  let request;
  let learning;
  let accessError = '';

  function render() {
    for (const action of Object.keys(directions)) {
      const binding = bindings[action];
      get(`midi-${action}-binding`).textContent = binding ? `CC ${binding.cc} · canal ${binding.channel}` : 'Non assigné';
      const learn = get(`midi-${action}-learn`);
      learn.disabled = !supported;
      learn.textContent = learning === action ? 'Annuler' : 'MIDI Learn';
      learn.setAttribute('aria-pressed', String(learning === action));
      get(`midi-${action}-clear`).hidden = !binding;
    }
    enable.hidden = !supported || Boolean(access) || !Object.keys(bindings).length;
    enable.disabled = Boolean(request);
    if (!supported) status.textContent = 'Ce navigateur ne prend pas en charge le MIDI.';
    else if (request) status.textContent = 'Autorisation MIDI en cours…';
    else if (accessError) status.textContent = accessError;
    else if (access && !inputs.size) status.textContent = 'Branche un périphérique MIDI pour continuer.';
    else if (learning) status.textContent = 'Actionne la commande à associer sur ton périphérique MIDI.';
    else if (access) status.textContent = 'MIDI actif sur cet appareil.';
    else status.textContent = 'Sélectionne MIDI Learn pour associer une commande.';
  }

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(bindings)); }
    catch {
      return 'Les assignations sont actives pour cette session. Leur enregistrement est indisponible.';
    }
    return '';
  }

  function receive({data}) {
    const [statusByte, cc, value] = data;
    if ((statusByte & 0xf0) !== 0xb0 || !value) return;
    const message = {channel: (statusByte & 0x0f) + 1, cc};
    if (learning) {
      for (const action of Object.keys(directions)) {
        if (sameCC(bindings[action], message)) delete bindings[action];
      }
      bindings[learning] = message;
      learning = undefined;
      const error = save();
      render();
      if (error) status.textContent = error;
      return;
    }
    const action = Object.keys(directions).find(direction => sameCC(bindings[direction], message));
    if (action) jumpBy(directions[action]);
  }

  function refreshInputs() {
    const connected = new Set([...access.inputs.values()].filter(input => input.state === 'connected'));
    for (const input of inputs) {
      if (connected.has(input)) continue;
      input.onmidimessage = null;
      inputs.delete(input);
    }
    for (const input of connected) {
      if (inputs.has(input)) continue;
      inputs.add(input);
      input.onmidimessage = receive;
    }
    render();
  }

  function connect() {
    if (access || request) { render(); return; }
    accessError = '';
    request = navigator.requestMIDIAccess({sysex: false}).then(result => {
      access = result;
      access.onstatechange = refreshInputs;
      refreshInputs();
    }).catch(() => {
      learning = undefined;
      accessError = 'Accès MIDI indisponible. Vérifie les autorisations du site, puis réessaie.';
    }).finally(() => {
      request = undefined;
      render();
    });
    render();
  }

  get('settings-button').onclick = () => dialog.showModal();
  dialog.addEventListener('close', () => { learning = undefined; render(); });
  enable.onclick = connect;
  for (const action of Object.keys(directions)) {
    get(`midi-${action}-learn`).onclick = () => {
      learning = learning === action ? undefined : action;
      if (learning) connect();
      else render();
    };
    get(`midi-${action}-clear`).onclick = () => {
      delete bindings[action];
      if (learning === action) learning = undefined;
      const error = save();
      render();
      if (error) status.textContent = error;
      get(`midi-${action}-learn`).focus();
    };
  }
  render();
  if (supported && Object.keys(bindings).length && navigator.permissions) {
    navigator.permissions.query({name: 'midi', sysex: false}).then(permission => {
      if (permission.state === 'granted' && Object.keys(bindings).length) connect();
    }).catch(() => {});
  }
}
