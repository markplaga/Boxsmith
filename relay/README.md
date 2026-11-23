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
model, the other edits placement and color. It only passes small messages between the two
screens of a session. Nothing is stored, and a session ends when the model screen closes.

- `GET /` answers `Boxsmith relay OK` (health check).
- WebSocket at `/ws`. The first message is `{"t":"join","room":"482917","role":"host"|"remote"}`.
  After that, every message is passed on to the other screens in the same room.

Optional settings (Space → Settings → Variables): `ALLOWED_ORIGINS`, a comma-separated list such
as `https://markplaga.github.io,http://localhost:8765`. Leave it unset to allow any page.

Two windows on the same computer don't need this relay at all.
