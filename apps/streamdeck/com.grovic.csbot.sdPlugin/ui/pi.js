// Property inspector glue (runs inside the Stream Deck app). Each page lists its fields as
// <select data-key="..."> elements; changes are saved as the key's settings.
/* global window, document, WebSocket */
let socket, context, settings = {};

function bind() {
  for (const el of document.querySelectorAll('[data-key]')) {
    const key = el.dataset.key, num = el.dataset.type === 'number';
    if (settings[key] !== undefined) el.value = String(settings[key]);
    else settings[key] = num ? Number(el.value) : el.value;
    el.addEventListener('change', () => {
      settings[key] = num ? Number(el.value) : el.value;
      socket.send(JSON.stringify({ event: 'setSettings', context, payload: settings }));
    });
  }
  socket.send(JSON.stringify({ event: 'setSettings', context, payload: settings }));
}

window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
  context = uuid;
  try { settings = JSON.parse(actionInfo).payload.settings || {}; } catch { settings = {}; }
  socket = new WebSocket('ws://127.0.0.1:' + port);
  socket.onopen = () => { socket.send(JSON.stringify({ event: registerEvent, uuid })); bind(); };
};
