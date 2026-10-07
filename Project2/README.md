# Socially

A mini social media platform built with HTML, CSS, JavaScript, Express, and SQLite.

## Features

- User registration and login with bcrypt password hashing and JWT sessions
- User profiles with bios, post history, follower/following counts
- Create text posts with optional image URLs
- Like/unlike posts
- Add comments to posts
- Follow/unfollow users
- Seeded demo content for a useful first launch

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000. Demo account: `maya` / `password123`.

The SQLite file `socially.db` is created automatically on first run. Set `JWT_SECRET` in production.
