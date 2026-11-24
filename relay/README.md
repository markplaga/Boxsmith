---
title: Boxsmith Relay
emoji: 📦
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

# Boxsmith relay

Links two screens for Boxsmith's **Remote** (Arrange boxes → 📱 Remote): one screen shows the
model, the other edits placement and color. It only passes messages between the screens of a
session. Nothing is stored, and a session ends when the model screen closes.

- `GET /` answers `Boxsmith relay OK` (health check).
- WebSocket at `/ws`. The first message is `{"t":"join","room":"482917","role":"host"|"remote"}`.
  After that, every message is passed on to the other screens in the same room.

## Limits and errors

- **Size.** One message can be up to **32 MiB** (33,554,432 bytes). A bigger one is not passed on;
  instead its sender gets `{"t":"error","code":"too_large","limit":33554432,"size":34603066,"id":"…"}`
  (`id` is the message's own `id`, if it had one) and the connection stays open. A single WebSocket
  frame over 96 MiB can't be answered: the relay closes that connection with code 1009.
- **Rate.** Each screen can send 60 messages a second (bursts up to 60). Faster messages are not passed
  on, and the sender gets `{"t":"error","code":"rate_limited","limit":60}` (at most once a second).
  Use the `batch` command to send many small commands as one message.

## Sending big messages in chunks

Messages up to 32 MiB can simply be sent whole. For anything bigger, or to keep each send small on a
slow connection, cut the message's JSON text into pieces and send each piece as a `chunk` message.
Boxsmith itself does this for any message over 7.5 MiB, in both directions.

```json
{ "t": "chunk", "id": "reel-v2", "part": 1, "of": 4, "data": "{\"t\":\"cmd\",\"op\":\"animate\",\"args\":{\"keyframes\":[…" }
{ "t": "chunk", "id": "reel-v2", "part": 2, "of": 4, "data": "…" }
```

- `id`: any string, the same for every piece of one message, and different for each message.
- `part`: 1, 2, … `of`; `of`: how many pieces there are. Pieces may arrive in any order.
- `data`: the next slice of the whole message's JSON text (`JSON.stringify` of the full
  `{"t":"cmd","op":"animate",…}`). Cut the text anywhere; the pieces are joined as plain text.
- Recommended size: **4 MiB of `data` per piece** (anything up to about 7.5 MiB works with every
  version of the relay). Send the pieces one after another; there's no need to wait between them.
- The receiving screen keeps the pieces by `id`, and when all `of` have arrived it joins the `data`
  strings in `part` order, parses the result and handles it like any other message, so a chunked
  `animate` loads exactly as if it had been sent whole.

In JavaScript, `BoxsmithAnim.splitMessage(message)` and `BoxsmithAnim.joinParts(store, piece)` from
`remote-anim.js` do both halves. In Python:

```python
import json, uuid
def chunks(message, size=4 * 1024 * 1024):
    text, mid = json.dumps(message), uuid.uuid4().hex
    n = -(-len(text) // size)
    return [{"t": "chunk", "id": mid, "part": k + 1, "of": n, "data": text[k * size:(k + 1) * size]} for k in range(n)]

for piece in chunks({"t": "cmd", "op": "animate", "args": animation}):
    ws.send(json.dumps(piece))
```

**Slow connections.** A big message sent as one huge frame can take minutes on a slow upload, and nothing else (not even the answer to the relay's keep-alive ping) can get through meanwhile. Pieces of about 1 MiB, sent as the socket's buffer drains, avoid that; Boxsmith does this itself. The relay also treats bytes still arriving as a sign that the sender is alive. If a host does drop, its room is kept for 10 minutes: remotes get `{"t":"hostgone"}`, stay connected, and get `{"t":"hostback"}` when the host reconnects with the same code (`{"t":"hostgone","final":true}` if it never does).

For an animation that's already in a zip open on the model screen, nothing needs sending at all:
`{"t":"cmd","op":"libraryPlay","args":{"name":"Tower crash"}}` plays it from there.

Optional settings (Space → Settings → Variables): `ALLOWED_ORIGINS`, a comma-separated list such
as `https://markplaga.github.io,http://localhost:8765`. Leave it unset to allow any page.

Two windows on the same computer don't need this relay at all.
