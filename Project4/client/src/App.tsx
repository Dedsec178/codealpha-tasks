import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { ArrowUpRight, Check, ChevronDown, CircleHelp, FileUp, LockKeyhole, Mic, MicOff, MonitorUp, MoreHorizontal, Paperclip, PenLine, PhoneOff, Plus, Send, ShieldCheck, Sparkles, Users, Video, VideoOff, Wifi } from 'lucide-react'

type Person = { id: string; name: string; socketId?: string; local?: boolean; stream?: MediaStream }
type Message = { text: string; sender: string; time: string }
type Stroke = { points: { x: number; y: number }[]; color: string }
type EncryptedFile = { name: string; sender: string; size: number; data: string; iv: string }
const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

function App() {
  const [authed, setAuthed] = useState(false)
  const [name, setName] = useState('Alex Morgan')
  const [email, setEmail] = useState('alex@huddle.test')
  const [password, setPassword] = useState('password123')
  const [roomId, setRoomId] = useState('design-sync')
  const [people, setPeople] = useState<Person[]>([{ id: 'local', name, local: true }])
  const [messages, setMessages] = useState<Message[]>([{ text: 'Welcome to the room. Share a thought, sketch an idea, or drop a file.', sender: 'Huddle bot', time: '09:41' }])
  const [message, setMessage] = useState('')
  const [muted, setMuted] = useState(false)
  const [camera, setCamera] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [tab, setTab] = useState<'chat' | 'board' | 'files'>('chat')
  const [toast, setToast] = useState('')
  const socketRef = useRef<Socket | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef(new Map<string, RTCPeerConnection>())
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => { setPeople((current) => current.map((person) => person.local ? { ...person, name } : person)) }, [name])
  useEffect(() => {
    if (!authed) return
    let active = true
    navigator.mediaDevices?.getUserMedia({ video: true, audio: true }).then((stream) => {
      if (!active) return stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      peersRef.current.forEach((peer) => stream.getTracks().forEach((track) => peer.addTrack(track, stream)))
    }).catch(() => showToast('Camera access is unavailable; you can still collaborate'))
    return () => { active = false; mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); screenStreamRef.current?.getTracks().forEach((track) => track.stop()); peersRef.current.forEach((peer) => peer.close()); peersRef.current.clear(); mediaStreamRef.current = null; screenStreamRef.current = null }
  }, [authed])
  useEffect(() => { mediaStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = camera }) }, [camera])
  useEffect(() => { mediaStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted }) }, [muted])
  useEffect(() => {
    if (!authed) return
    const socket = io(serverUrl, { auth: { token: localStorage.getItem('huddle-token') ?? 'demo' } })
    socketRef.current = socket
    socket.on('connect', () => socket.emit('room:join', { roomId }))
    socket.on('room:users', (users: Person[]) => { setPeople([{ id: 'local', name, local: true }, ...users]); users.forEach((user) => user.socketId && createPeer(user.socketId, true)) })
    socket.on('room:user-joined', (person: Person) => { setPeople((current) => [...current, person]); if (person.socketId) createPeer(person.socketId, true); showToast(`${person.name} joined the room`) })
    socket.on('room:user-left', (id: string) => setPeople((current) => current.filter((person) => person.id !== id)))
    socket.on('room:message', (incoming: Omit<Message, 'time'>) => setMessages((current) => [...current, { ...incoming, time: now() }]))
    socket.on('room:file', (file: EncryptedFile) => setMessages((current) => [...current, { text: `Shared ${file.name} (${formatBytes(file.size)})`, sender: file.sender, time: now() }]))
    socket.on('room:whiteboard', (stroke: Stroke) => drawStroke(stroke, false))
    socket.on('signal', async ({ from, signal }: { from: string; signal: RTCSessionDescriptionInit | RTCIceCandidateInit }) => {
      const peer = peersRef.current.get(from) ?? createPeer(from, false)
      if (!peer) return
      if ('type' in signal && (signal.type === 'offer' || signal.type === 'answer')) {
        await peer.setRemoteDescription(signal as RTCSessionDescriptionInit)
        if (signal.type === 'offer') { const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); socket.emit('signal', { target: from, signal: answer }) }
      } else await peer.addIceCandidate(signal as RTCIceCandidateInit)
    })
    return () => { socket.disconnect() }
  }, [authed, roomId])

  function showToast(text: string) { setToast(text); window.setTimeout(() => setToast(''), 2800) }
  function now() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  async function join() {
    if (!name.trim()) return showToast('Add your name to enter the room')
    try {
      const payload = JSON.stringify({ name, email, password })
      let response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
      if (!response.ok) response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const result = await response.json() as { token?: string; error?: string }
      if (!response.ok || !result.token) return showToast(result.error ?? 'Unable to authenticate')
      localStorage.setItem('huddle-token', result.token)
      setAuthed(true)
    } catch { showToast('The Huddle server is unavailable') }
  }
  function sendMessage() {
    if (!message.trim()) return
    const outgoing = { text: message.trim(), sender: name }
    setMessages((current) => [...current, { ...outgoing, time: now() }])
    socketRef.current?.emit('room:message', { roomId, message: outgoing })
    setMessage('')
  }
  function createPeer(target: string, initiator: boolean) {
    const existing = peersRef.current.get(target); if (existing) return existing
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    mediaStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, mediaStreamRef.current!))
    peer.onicecandidate = (event) => { if (event.candidate) socketRef.current?.emit('signal', { target, signal: event.candidate.toJSON() }) }
    peer.ontrack = (event) => setPeople((current) => current.map((person) => person.socketId === target ? { ...person, stream: event.streams[0] } : person))
    peersRef.current.set(target, peer)
    if (initiator) peer.createOffer().then(async (offer) => { await peer.setLocalDescription(offer); socketRef.current?.emit('signal', { target, signal: offer }) })
    return peer
  }
  async function toggleScreenShare() {
    if (sharing) { stopScreenShare(); return }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      screenStreamRef.current = stream
      const track = stream.getVideoTracks()[0]
      peersRef.current.forEach((peer) => peer.getSenders().find((sender) => sender.track?.kind === 'video')?.replaceTrack(track))
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      track.onended = stopScreenShare
      setSharing(true); showToast('You are sharing your screen')
    } catch { showToast('Screen sharing was cancelled') }
  }
  function stopScreenShare() {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop()); screenStreamRef.current = null
    const cameraTrack = mediaStreamRef.current?.getVideoTracks()[0]
    peersRef.current.forEach((peer) => peer.getSenders().find((sender) => sender.track?.kind === 'video')?.replaceTrack(cameraTrack ?? null))
    if (localVideoRef.current) localVideoRef.current.srcObject = mediaStreamRef.current
    setSharing(false); showToast('Screen sharing stopped')
  }
  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const { data, iv } = await encryptFile(file)
    const outgoing: EncryptedFile = { name: file.name, sender: name, size: file.size, data, iv }
    setMessages((current) => [...current, { text: `Shared ${file.name} (${formatBytes(file.size)})`, sender: name, time: now() }])
    socketRef.current?.emit('room:file', { roomId, file: outgoing })
    showToast(`${file.name} encrypted with AES-GCM and shared`)
  }
  async function roomKey() { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`huddle:${roomId}`)); return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']) }
  async function encryptFile(file: File) { const iv = crypto.getRandomValues(new Uint8Array(12)); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await roomKey(), await file.arrayBuffer()); return { data: arrayToBase64(new Uint8Array(encrypted)), iv: arrayToBase64(iv) } }
  function arrayToBase64(bytes: Uint8Array) { let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary) }
  function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
  function drawStroke(stroke: Stroke, broadcast = true) {
    const canvas = canvasRef.current; if (!canvas) return
    const context = canvas.getContext('2d'); if (!context || stroke.points.length < 2) return
    context.strokeStyle = stroke.color; context.lineWidth = 3; context.lineCap = 'round'; context.beginPath(); context.moveTo(stroke.points[0].x, stroke.points[0].y)
    stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y)); context.stroke()
    if (broadcast) socketRef.current?.emit('room:whiteboard', { roomId, stroke })
  }
  function beginDraw(event: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; const rect = event.currentTarget.getBoundingClientRect(); const points = [{ x: event.clientX - rect.left, y: event.clientY - rect.top }]; (event.currentTarget as HTMLCanvasElement).dataset.points = JSON.stringify(points) }
  function continueDraw(event: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect(); const points = JSON.parse(canvas.dataset.points ?? '[]') as { x: number; y: number }[]; points.push({ x: event.clientX - rect.left, y: event.clientY - rect.top }); canvas.dataset.points = JSON.stringify(points); drawStroke({ points, color: '#d5fa72' }) }
  function endDraw(event: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; drawing.current = false; const canvas = event.currentTarget; const points = JSON.parse(canvas.dataset.points ?? '[]') as { x: number; y: number }[]; if (points.length > 1) drawStroke({ points, color: '#d5fa72' }); canvas.dataset.points = '[]' }

  if (!authed) return <AuthScreen name={name} setName={setName} email={email} setEmail={setEmail} password={password} setPassword={setPassword} roomId={roomId} setRoomId={setRoomId} join={join} />
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Sparkles size={16} /></span><span>huddle<span className="brand-dot">.</span></span></div><div className="workspace-label">WORKSPACE <button aria-label="Workspace menu"><ChevronDown size={14} /></button></div><div className="workspace-card"><div className="workspace-icon">DS</div><div><strong>Design studio</strong><span>Personal workspace</span></div><ChevronDown size={15} /></div><nav><a className="nav-active"><Video size={17} />Live room<span className="live-pip" /></a><a><Users size={17} />People<span className="nav-count">{people.length}</span></a><a><FileUp size={17} />Shared files</a></nav><div className="sidebar-bottom"><div className="security-note"><ShieldCheck size={18} /><div><strong>Private by default</strong><span>End-to-end encrypted</span></div></div><div className="profile"><div className="avatar">AM</div><div><strong>{name}</strong><span>Available</span></div><MoreHorizontal size={17} /></div></div></aside><main className="main"><header className="topbar"><div><div className="eyebrow"><span className="live-dot" />LIVE ROOM <span className="slash">/</span> {roomId}</div><h1>Design sync <span className="status-pill"><Wifi size={12} /> Excellent</span></h1></div><div className="top-actions"><button className="icon-button" aria-label="Help"><CircleHelp size={18} /></button><button className="invite-button" onClick={() => { navigator.clipboard?.writeText(window.location.href); showToast('Invite link copied') }}><Plus size={17} /> Invite</button></div></header><section className="content"><div className="stage"><div className="video-grid">{people.map((person, index) => <div className={`video-tile tile-${index}`} key={person.id}><div className="video-placeholder">{person.local && <video ref={localVideoRef} autoPlay muted playsInline className="local-video" />}<div className="video-glow" /><div className="large-avatar">{person.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div><span className="camera-label"><span className="speaking-dot" />{person.name}{person.local ? ' (You)' : ''}</span><span className="tile-menu"><MoreHorizontal size={17} /></span></div></div>)}{people.length === 1 && <div className="waiting-tile"><Users size={23} /><strong>Invite your team</strong><span>Your room is ready when they are.</span><button onClick={() => { navigator.clipboard?.writeText(window.location.href); showToast('Invite link copied') }}>Copy invite link <ArrowUpRight size={15} /></button></div>}</div><div className="call-controls"><div className="control-group"><button className={muted ? 'control danger' : 'control'} onClick={() => setMuted(!muted)} aria-label="Toggle microphone">{muted ? <MicOff /> : <Mic />}<span>{muted ? 'Unmute' : 'Mute'}</span></button><button className={!camera ? 'control danger' : 'control'} onClick={() => setCamera(!camera)} aria-label="Toggle camera">{camera ? <Video /> : <VideoOff />}<span>{camera ? 'Camera' : 'Camera off'}</span></button><button className={sharing ? 'control active' : 'control'} onClick={toggleScreenShare} aria-label="Share screen"><MonitorUp /><span>{sharing ? 'Stop share' : 'Share screen'}</span></button></div><button className="leave-button" onClick={() => setAuthed(false)}><PhoneOff size={17} /> Leave</button></div></div><aside className="collab-panel"><div className="panel-tabs"><button className={tab === 'chat' ? 'selected' : ''} onClick={() => setTab('chat')}>Chat<span>{messages.length}</span></button><button className={tab === 'board' ? 'selected' : ''} onClick={() => setTab('board')}><PenLine size={14} />Board</button><button className={tab === 'files' ? 'selected' : ''} onClick={() => setTab('files')}><Paperclip size={14} />Files</button></div>{tab === 'chat' && <div className="chat-pane"><div className="encryption-banner"><LockKeyhole size={14} /><span>Messages are end-to-end encrypted</span></div><div className="messages">{messages.map((item, index) => <div className={`message ${item.sender === name ? 'mine' : ''}`} key={`${item.time}-${index}`}><div className="message-avatar">{item.sender.slice(0, 2).toUpperCase()}</div><div><div className="message-meta"><strong>{item.sender}</strong><time>{item.time}</time></div><p>{item.text}</p></div></div>)}</div><div className="composer"><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && sendMessage()} placeholder="Message the room..." /><button onClick={sendMessage} aria-label="Send message"><Send size={17} /></button></div></div>}{tab === 'board' && <div className="board-pane"><div className="board-toolbar"><span>Shared canvas</span><button onClick={() => { const canvas = canvasRef.current; canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height) }}>Clear</button></div><canvas ref={canvasRef} width="430" height="620" onPointerDown={beginDraw} onPointerMove={continueDraw} onPointerUp={endDraw} onPointerLeave={endDraw} /></div>}{tab === 'files' && <div className="files-pane"><label className="upload-drop"><FileUp size={24} /><strong>Drop a file here</strong><span>Encrypted before it leaves your browser</span><input type="file" onChange={handleFile} /></label><div className="file-list"><div><FileUp size={17} /><span><strong>Project brief.pdf</strong><small>Shared yesterday · 2.4 MB</small></span><Check size={16} /></div><div><FileUp size={17} /><span><strong>Brand explorations.fig</strong><small>Shared Monday · 8.1 MB</small></span><Check size={16} /></div></div></div>}</aside></section></main>{toast && <div className="toast"><Check size={16} />{toast}</div>}</div>
}

function AuthScreen({ name, setName, email, setEmail, password, setPassword, roomId, setRoomId, join }: { name: string; setName: (value: string) => void; email: string; setEmail: (value: string) => void; password: string; setPassword: (value: string) => void; roomId: string; setRoomId: (value: string) => void; join: () => void }) {
  return <div className="auth-page"><div className="auth-visual"><div className="auth-brand"><span className="brand-mark"><Sparkles size={16} /></span>huddle<span className="brand-dot">.</span></div><div className="auth-quote"><span>“</span><h1>Make space<br />for good work.</h1><p>A calm, connected room for teams who care about the details.</p></div><div className="auth-visual-footer"><span><LockKeyhole size={14} /> Your room is private and encrypted</span><span>01 — 04</span></div></div><div className="auth-form-wrap"><div className="auth-form"><div className="form-kicker">WELCOME TO HUDDLE</div><h2>Bring your people<br /><em>into focus.</em></h2><p className="form-intro">Create a secure room and start collaborating in seconds.</p><label>Your name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alex Morgan" /></label><label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Room name<input value={roomId} onChange={(event) => setRoomId(event.target.value)} /></label><button className="enter-button" onClick={join}>Enter your room <ArrowUpRight size={18} /></button><div className="form-foot"><ShieldCheck size={15} /> Your data is protected with modern encryption.</div></div></div></div>
}

export default App
