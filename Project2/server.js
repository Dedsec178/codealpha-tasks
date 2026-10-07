const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const db = new Database(path.join(__dirname, 'socially.db'));
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, bio TEXT DEFAULT '', avatar TEXT DEFAULT '', password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, content TEXT NOT NULL,
    image_url TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL, following_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );
`);

const seed = db.prepare('SELECT COUNT(*) AS count FROM users').get();
if (seed.count === 0) {
  const addUser = db.prepare('INSERT INTO users (username, name, bio, avatar, password_hash) VALUES (?, ?, ?, ?, ?)');
  const password = bcrypt.hashSync('password123', 10);
  const maya = addUser.run('maya', 'Maya Chen', 'Product designer, coffee enthusiast, and curious human.', 'MC', password).lastInsertRowid;
  const jordan = addUser.run('jordan', 'Jordan Bell', 'Building tiny things that make everyday life better.', 'JB', password).lastInsertRowid;
  const theo = addUser.run('theo', 'Theo Martins', 'Street photography and slow weekends.', 'TM', password).lastInsertRowid;
  const addPost = db.prepare('INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)');
  const post1 = addPost.run(maya, 'A small reminder: good products feel less like features and more like little moments of relief.', 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80').lastInsertRowid;
  const post2 = addPost.run(jordan, 'Shipped the first version today. The best part of building is watching an idea become useful to someone else.', '').lastInsertRowid;
  addPost.run(theo, 'Found this quiet corner of the city after the rain. Keeping it.', 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1200&q=80');
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').run(post1, jordan, 'This is such a good way to put it.');
  db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').run(post2, maya, 'That feeling never gets old.');
  db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(maya, jordan);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function tokenFor(user) { return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' }); }
function publicUser(user) { return { id: user.id, username: user.username, name: user.name, bio: user.bio, avatar: user.avatar }; }
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  try { req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please sign in to continue.' }); }
}
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  try { req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET); } catch { req.user = null; }
  next();
}
function postShape(post, viewerId) {
  const comments = db.prepare(`SELECT c.id, c.content, c.created_at AS createdAt, u.id AS userId, u.username, u.name, u.avatar FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC`).all(post.id);
  return { ...post, liked: !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(viewerId || 0, post.id), comments };
}

app.post('/api/auth/register', (req, res) => {
  const { username, name, password } = req.body;
  if (!username || !name || !password || password.length < 6) return res.status(400).json({ error: 'Name, username, and a password of 6+ characters are required.' });
  try {
    const result = db.prepare('INSERT INTO users (username, name, password_hash, avatar) VALUES (?, ?, ?, ?)').run(username.trim().toLowerCase(), name.trim(), bcrypt.hashSync(password, 10), name.trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase());
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ token: tokenFor(user), user: publicUser(user) });
  } catch { res.status(409).json({ error: 'That username is already taken.' }); }
});
app.post('/api/auth/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((req.body.username || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'Incorrect username or password.' });
  res.json({ token: tokenFor(user), user: publicUser(user) });
});
app.get('/api/me', auth, (req, res) => res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id))));
app.get('/api/feed', optionalAuth, (req, res) => {
  const posts = db.prepare(`SELECT p.id, p.content, p.image_url AS imageUrl, p.created_at AS createdAt, u.id AS userId, u.username, u.name, u.avatar, (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes, (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS commentCount FROM posts p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC, p.id DESC`).all();
  res.json(posts.map(post => postShape(post, req.user?.id)));
});
app.post('/api/posts', auth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content || content.length > 500) return res.status(400).json({ error: 'Posts must be between 1 and 500 characters.' });
  const result = db.prepare('INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)').run(req.user.id, content, (req.body.imageUrl || '').trim());
  const post = db.prepare(`SELECT p.id, p.content, p.image_url AS imageUrl, p.created_at AS createdAt, u.id AS userId, u.username, u.name, u.avatar, 0 AS likes, 0 AS commentCount FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(result.lastInsertRowid);
  res.status(201).json(postShape(post, req.user.id));
});
app.post('/api/posts/:id/like', auth, (req, res) => {
  const existing = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.user.id, req.params.id);
  if (existing) db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, req.params.id);
  else db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(req.user.id, req.params.id);
  res.json({ liked: !existing, likes: db.prepare('SELECT COUNT(*) AS count FROM likes WHERE post_id = ?').get(req.params.id).count });
});
app.post('/api/posts/:id/comments', auth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content || content.length > 240) return res.status(400).json({ error: 'Comments must be between 1 and 240 characters.' });
  const result = db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').run(req.params.id, req.user.id, content);
  const comment = db.prepare('SELECT c.id, c.content, c.created_at AS createdAt, u.id AS userId, u.username, u.name, u.avatar FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(result.lastInsertRowid);
  res.status(201).json(comment);
});
app.get('/api/users/:username', optionalAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, name, bio, avatar, created_at AS createdAt FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const profile = { ...user, followers: db.prepare('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?').get(user.id).count, following: db.prepare('SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?').get(user.id).count, isFollowing: !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user?.id || 0, user.id) };
  const posts = db.prepare(`SELECT p.id, p.content, p.image_url AS imageUrl, p.created_at AS createdAt, u.id AS userId, u.username, u.name, u.avatar, (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes, (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS commentCount FROM posts p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(user.id).map(post => postShape(post, req.user?.id));
  res.json({ profile, posts });
});
app.post('/api/users/:id/follow', auth, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot follow yourself.' });
  const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, req.params.id);
  if (existing) db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, req.params.id);
  else db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.user.id, req.params.id);
  res.json({ following: !existing });
});
app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Socially is running at http://localhost:${PORT}`));
