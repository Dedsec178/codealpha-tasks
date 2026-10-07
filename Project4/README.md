# Huddle Room

A full-stack real-time communication workspace for video meetings and collaborative work.

## Included

- Multi-user WebRTC-ready room signaling through Socket.IO
- Camera, microphone, and screen-share controls in the room UI
- Encrypted chat/file-sharing event channel and shared whiteboard
- JWT authentication endpoints with bcrypt password hashing
- Responsive React interface with room presence, chat, board, and files tabs

## Run locally

```bash
npm install
npm --prefix client install
npm --prefix server install
npm run dev
```

Open `http://localhost:5173`. The default demo form enters a local room immediately; the server auth endpoints are available at `/api/auth/register` and `/api/auth/login`.

For a production deployment, set `JWT_SECRET`, `CLIENT_URL`, terminate TLS at the edge, use a persistent database, and add a TURN server for WebRTC connections behind restrictive NATs.
