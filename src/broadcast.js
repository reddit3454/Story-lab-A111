import { WebSocket } from 'ws';

let _wss = null;

export function init(wss) {
  _wss = wss;
}

export function send(type, payload) {
  if (!_wss) return;
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  _wss.clients.forEach(function (client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

export default { init, send };
