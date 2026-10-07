import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import http from 'node:http'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'

const app = express()
const httpServer = http.createServer(app)
const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL ?? 'http://localhost:5173' } })
const port = Number(process.env.PORT ?? 3001)
const jwtSecret = process.env.JWT_SECRET ?? 'local-development-secret-change-me'
type User = { id: string; name: string; email: string; passwordHash: string }
type RoomUser = { id: string; name: string; socketId: string }
const users = new Map<string, User>()
const rooms = new Map<string, Map<string, RoomUser>>()

app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'huddle-room' }))
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string }
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Name, email and an 8-character password are required.' })
  const normalizedEmail = email.toLowerCase().trim()
  if ([...users.values()].some((user) => user.email === normalizedEmail)) return res.status(409).json({ error: 'An account with that email already exists.' })
  const user: User = { id: crypto.randomUUID(), name: name.trim(), email: normalizedEmail, passwordHash: await bcrypt.hash(password, 12) }
  users.set(user.id, user)
  return res.status(201).json({ token: jwt.sign({ sub: user.id, name: user.name }, jwtSecret, { expiresIn: '12h' }), user: { id: user.id, name: user.name, email: user.email } })
})
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  const user = [...users.values()].find((candidate) => candidate.email === email?.toLowerCase().trim())
  if (!user || !password || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password.' })
  return res.json({ token: jwt.sign({ sub: user.id, name: user.name }, jwtSecret, { expiresIn: '12h' }), user: { id: user.id, name: user.name, email: user.email } })
})

io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined
  try { socket.data.user = jwt.verify(token ?? '', jwtSecret) as { sub: string; name: string }; next() }
  catch { next(new Error('Authentication required')) }
})
io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId }: { roomId: string }) => {
    const user = socket.data.user as { sub: string; name: string }
    socket.join(roomId)
    const room = rooms.get(roomId) ?? new Map<string, RoomUser>()
    const existingUsers = [...room.values()]
    room.set(user.sub, { id: user.sub, name: user.name, socketId: socket.id })
    rooms.set(roomId, room)
    socket.emit('room:users', existingUsers)
    socket.to(roomId).emit('room:user-joined', { id: user.sub, name: user.name, socketId: socket.id })
  })
  socket.on('signal', ({ target, signal }: { target: string; signal: unknown }) => io.to(target).emit('signal', { from: socket.id, signal }))
  socket.on('room:message', ({ roomId, message }: { roomId: string; message: { text: string; sender: string } }) => socket.to(roomId).emit('room:message', message))
  socket.on('room:whiteboard', ({ roomId, stroke }: { roomId: string; stroke: unknown }) => socket.to(roomId).emit('room:whiteboard', stroke))
  socket.on('room:file', ({ roomId, file }: { roomId: string; file: unknown }) => socket.to(roomId).emit('room:file', file))
  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms) for (const [userId, member] of room) if (member.socketId === socket.id) {
      room.delete(userId)
      socket.to(roomId).emit('room:user-left', userId)
      if (!room.size) rooms.delete(roomId)
    }
  })
})
httpServer.listen(port, () => console.log(`Huddle server listening on http://localhost:${port}`))
