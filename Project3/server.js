const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const initialData = { users: [], projects: [], tasks: [], comments: [], sessions: [] };
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const id = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, initials: user.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase() });
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex')}`;
const validPassword = (password, stored) => { const [salt, hash] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512')); };
const broadcast = (message) => wss.clients.forEach(client => client.readyState === 1 && client.send(JSON.stringify(message)));

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = db.sessions.find(item => item.token === token);
  if (!session) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = db.users.find(user => user.id === session.userId);
  next();
}
function projectView(project, userId) {
  const tasks = db.tasks.filter(task => task.projectId === project.id).map(task => ({ ...task, assignee: task.assigneeId ? publicUser(db.users.find(user => user.id === task.assigneeId)) : null, comments: db.comments.filter(comment => comment.taskId === task.id).map(comment => ({ ...comment, author: publicUser(db.users.find(user => user.id === comment.authorId)) })) }));
  return { ...project, owner: publicUser(db.users.find(user => user.id === project.ownerId)), members: project.memberIds.map(memberId => publicUser(db.users.find(user => user.id === memberId))).filter(Boolean), tasks, isOwner: project.ownerId === userId };
}

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Name, email, and a 6+ character password are required.' });
  if (db.users.some(user => user.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'An account with that email already exists.' });
  const user = { id: id('usr'), name: name.trim(), email: email.toLowerCase().trim(), passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  db.users.push(user); save();
  const token = id('sess'); db.sessions.push({ token, userId: user.id }); save();
  res.json({ token, user: publicUser(user) });
});
app.post('/api/auth/login', (req, res) => {
  const user = db.users.find(item => item.email === req.body.email?.toLowerCase().trim());
  if (!user || !validPassword(req.body.password || '', user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const token = id('sess'); db.sessions.push({ token, userId: user.id }); save(); res.json({ token, user: publicUser(user) });
});
app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.post('/api/auth/logout', auth, (req, res) => { db.sessions = db.sessions.filter(item => item.userId !== req.user.id); save(); res.json({ ok: true }); });

app.get('/api/projects', auth, (req, res) => res.json({ projects: db.projects.filter(project => project.memberIds.includes(req.user.id)).map(project => projectView(project, req.user.id)) }));
app.post('/api/projects', auth, (req, res) => {
  if (!req.body.name?.trim()) return res.status(400).json({ error: 'A project name is required.' });
  const project = { id: id('prj'), name: req.body.name.trim(), description: req.body.description?.trim() || 'A new shared workspace', color: req.body.color || '#ef8c5b', ownerId: req.user.id, memberIds: [req.user.id], createdAt: new Date().toISOString() };
  db.projects.push(project); save(); broadcast({ type: 'project:created', projectId: project.id }); res.status(201).json({ project: projectView(project, req.user.id) });
});
app.get('/api/projects/:projectId', auth, (req, res) => { const project = db.projects.find(item => item.id === req.params.projectId && item.memberIds.includes(req.user.id)); if (!project) return res.status(404).json({ error: 'Project not found.' }); res.json({ project: projectView(project, req.user.id) }); });
app.post('/api/projects/:projectId/members', auth, (req, res) => {
  const project = db.projects.find(item => item.id === req.params.projectId && item.ownerId === req.user.id); if (!project) return res.status(403).json({ error: 'Only the project owner can invite members.' });
  const member = db.users.find(user => user.email === req.body.email?.toLowerCase().trim()); if (!member) return res.status(404).json({ error: 'No account found with that email.' });
  if (!project.memberIds.includes(member.id)) project.memberIds.push(member.id); save(); broadcast({ type: 'project:updated', projectId: project.id }); res.json({ project: projectView(project, req.user.id) });
});
app.post('/api/projects/:projectId/tasks', auth, (req, res) => {
  const project = db.projects.find(item => item.id === req.params.projectId && item.memberIds.includes(req.user.id)); if (!project) return res.status(404).json({ error: 'Project not found.' });
  if (!req.body.title?.trim()) return res.status(400).json({ error: 'A task title is required.' });
  const task = { id: id('tsk'), projectId: project.id, title: req.body.title.trim(), description: req.body.description?.trim() || '', status: ['todo', 'progress', 'done'].includes(req.body.status) ? req.body.status : 'todo', priority: ['low', 'medium', 'high'].includes(req.body.priority) ? req.body.priority : 'medium', assigneeId: project.memberIds.includes(req.body.assigneeId) ? req.body.assigneeId : null, dueDate: req.body.dueDate || null, createdBy: req.user.id, createdAt: new Date().toISOString() };
  db.tasks.push(task); save(); broadcast({ type: 'task:updated', projectId: project.id }); res.status(201).json({ task });
});
app.patch('/api/tasks/:taskId', auth, (req, res) => {
  const task = db.tasks.find(item => item.id === req.params.taskId); const project = task && db.projects.find(item => item.id === task.projectId && item.memberIds.includes(req.user.id)); if (!task || !project) return res.status(404).json({ error: 'Task not found.' });
  ['title', 'description', 'dueDate'].forEach(key => { if (req.body[key] !== undefined) task[key] = req.body[key]; });
  if (req.body.status && ['todo', 'progress', 'done'].includes(req.body.status)) task.status = req.body.status;
  if (req.body.priority && ['low', 'medium', 'high'].includes(req.body.priority)) task.priority = req.body.priority;
  if (req.body.assigneeId !== undefined) task.assigneeId = project.memberIds.includes(req.body.assigneeId) ? req.body.assigneeId : null;
  save(); broadcast({ type: 'task:updated', projectId: project.id }); res.json({ task });
});
app.post('/api/tasks/:taskId/comments', auth, (req, res) => {
  const task = db.tasks.find(item => item.id === req.params.taskId); const project = task && db.projects.find(item => item.id === task.projectId && item.memberIds.includes(req.user.id)); if (!task || !project) return res.status(404).json({ error: 'Task not found.' });
  if (!req.body.body?.trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const comment = { id: id('com'), taskId: task.id, authorId: req.user.id, body: req.body.body.trim(), createdAt: new Date().toISOString() }; db.comments.push(comment); save(); broadcast({ type: 'comment:created', projectId: project.id }); res.status(201).json({ comment: { ...comment, author: publicUser(req.user) } });
});

wss.on('connection', socket => socket.send(JSON.stringify({ type: 'connected' })));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, () => console.log(`Orbit is running at http://localhost:${PORT}`));
