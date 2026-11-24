'use strict';
// Boxsmith relay: passes messages between the screens of one Remote session.
// A session ("room") is a 6-digit code. One host (the screen showing the model) and up to
// eight remotes. Nothing is stored; a room disappears when its host leaves.
const http = require('node:http');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 7860;
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
// MAX_BYTES: the biggest message passed on. A bigger one is not passed on, and its sender gets
// {t:'error', code:'too_large', limit, size} back. FRAME_BYTES is the hard cap for one WebSocket
// frame; past it the socket is closed with code 1009 (the reply can't be sent without reading it).
const MAX_ROOMS = 1000, MAX_REMOTES = 8, MAX_BYTES = 32 * 1024 * 1024, FRAME_BYTES = 96 * 1024 * 1024, MSGS_PER_SEC = 60;

const rooms = new Map();   // code -> { host, remotes:Set }

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
  res.end('Boxsmith relay OK\n');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: FRAME_BYTES,
  verifyClient: ({ origin }) => !ALLOWED.length || ALLOWED.includes(origin) });

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function leave(ws) {
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  if (room.host === ws) {
    for (const r of room.remotes) send(r, { t: 'hostgone' });
    rooms.delete(ws.room);
  } else {
    room.remotes.delete(ws);
    send(room.host, { t: 'peers', remotes: room.remotes.size });
  }
  ws.room = null;
}

wss.on('connection', ws => {
  ws.alive = true; ws.room = null; ws.tokens = MSGS_PER_SEC; ws.last = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    ws.tokens = Math.min(MSGS_PER_SEC, ws.tokens + (now - ws.last) / 1000 * MSGS_PER_SEC); ws.last = now;
    if (ws.tokens < 1) {                  // too fast: not passed on, and the sender is told (once a second at most)
      if (now - (ws.toldFast || 0) > 1000) { ws.toldFast = now; send(ws, { t: 'error', code: 'rate_limited', limit: MSGS_PER_SEC, msg: 'Messages are coming faster than ' + MSGS_PER_SEC + ' a second, so some were not passed on. Use batch, or slow down.' }); }
      return;
    }
    ws.tokens -= 1;
    const bytes = data.length;
    if (bytes > MAX_BYTES) {
      let id; try { id = JSON.parse(data.toString()).id; } catch { }
      return send(ws, { t: 'error', code: 'too_large', limit: MAX_BYTES, size: bytes, id, msg: 'That message is ' + bytes + ' bytes; the relay passes on messages up to ' + MAX_BYTES + ' bytes. Send it in chunks (see the relay README).' });
    }
    const text = data.toString();
    if (!ws.room) {
      let msg; try { msg = JSON.parse(text); } catch { return ws.close(1003, 'bad message'); }
      if (!msg || msg.t !== 'join' || !/^\d{6}$/.test(msg.room) || !['host', 'remote'].includes(msg.role)) return ws.close(1008, 'join first');
      let room = rooms.get(msg.room);
      if (msg.role === 'host') {
        if (room && room.host && room.host.readyState === 1) { send(ws, { t: 'error', msg: 'That code is already in use. Pick a new one.' }); return ws.close(); }
        if (!room) { if (rooms.size >= MAX_ROOMS) { send(ws, { t: 'error', msg: 'The relay is busy. Try again shortly.' }); return ws.close(); } room = { host: null, remotes: new Set() }; rooms.set(msg.room, room); }
        room.host = ws; ws.room = msg.room; ws.role = 'host';
        send(ws, { t: 'joined', role: 'host', remotes: room.remotes.size });
        for (const r of room.remotes) send(r, { t: 'hostback' });
      } else {
        if (!room || !room.host) { send(ws, { t: 'nohost' }); return ws.close(); }
        if (room.remotes.size >= MAX_REMOTES) { send(ws, { t: 'error', msg: 'Too many remotes on this code.' }); return ws.close(); }
        room.remotes.add(ws); ws.room = msg.room; ws.role = 'remote';
        send(ws, { t: 'joined', role: 'remote' });
        send(room.host, { t: 'peers', remotes: room.remotes.size });
      }
      return;
    }
    const room = rooms.get(ws.room);
    if (!room) return;
    const targets = ws.role === 'host' ? room.remotes : [room.host];
    for (const t of targets) if (t && t.readyState === 1) t.send(text);
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// drop connections that stopped answering (phones that went to sleep, closed tabs)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { leave(ws); ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 25000).unref();

server.listen(PORT, () => console.log('Boxsmith relay on port ' + PORT));
