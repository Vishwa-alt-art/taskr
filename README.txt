# Taskr — Team Task Manager

A full-stack web app where teams can create projects, assign tasks, and track progress.
Built with Node.js + Express (backend), plain HTML/CSS/JS (frontend), PostgreSQL (database).

---

## What this app does

- Signup / Login with JWT authentication
- Two roles: Admin (boss) and Member (worker)
- Admin can create projects and assign tasks to members
- Members can see their own tasks and update status (To Do → In Progress → Done)
- Dashboard with task counts and a live activity feed
- Overdue tasks are highlighted automatically
- Every action is logged (who did what, when)

---

## Project structure

```
task-manager/
├── backend/
│   ├── server.js       ← All backend logic in one file
│   ├── package.json    ← Node dependencies
│   └── .env            ← Secret keys (never commit this!)
└── frontend/
    └── index.html      ← Entire frontend in one file
```

---

## How to run locally (step by step)

### Step 1 — Install Node.js
Go to nodejs.org → download LTS version → install

### Step 2 — Set up backend
```bash
cd backend
npm install
```

Create a `.env` file inside the `backend/` folder:
```
DATABASE_URL=postgresql://localhost:5432/taskr
JWT_SECRET=any_random_secret_string_here_make_it_long
PORT=5000
```

### Step 3 — Set up PostgreSQL locally
Install PostgreSQL from postgresql.org.
Then create a database:
```bash
psql -U postgres
CREATE DATABASE taskr;
\q
```

### Step 4 — Run the backend
```bash
cd backend
node server.js
```
You should see: ✅ Database tables ready / 🚀 Server running on port 5000

### Step 5 — Open the frontend
Just open `frontend/index.html` in your browser.
The app will connect to localhost:5000 automatically.

---

## How to deploy on Railway (mandatory for submission)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/YOUR_USERNAME/task-manager.git
git push -u origin main
```

### Step 2 — Deploy backend on Railway
1. Go to railway.app → New Project → Deploy from GitHub
2. Select your repository
3. Railway will auto-detect it's a Node.js app
4. Add these environment variables in Railway dashboard:
   - JWT_SECRET = any_long_random_string
   - NODE_ENV = production
5. Add a PostgreSQL database: + New → Database → PostgreSQL
6. Railway automatically sets DATABASE_URL — no action needed

### Step 3 — Serve the frontend
Option A (simplest): Copy `frontend/index.html` into the `backend/` folder.
Then add this line in server.js (before the initDB() call):
```javascript
const path = require('path')
app.use(express.static(path.join(__dirname, 'frontend')))
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'index.html')))
```

Option B: Deploy frontend separately on Netlify (free).
- Go to netlify.com → drag and drop your frontend folder → done
- Change the API variable in index.html to point to your Railway URL

### Step 4 — Get your live URL
Railway gives you a URL like: https://task-manager-production-xxxx.up.railway.app
That's your submission URL!

---

## Tech stack explained simply

| Part | Technology | Why |
|------|-----------|-----|
| Web server | Express.js | Simple, popular, lots of tutorials |
| Database | PostgreSQL | Reliable SQL, Railway supports it free |
| Login system | JWT (JSON Web Tokens) | Industry standard, stateless |
| Password security | bcryptjs | Never store plain text passwords |
| Frontend | Vanilla HTML/CSS/JS | No build tools needed, fast to write |

---

## API routes reference

| Method | URL | Who can use | What it does |
|--------|-----|-------------|--------------|
| POST | /api/auth/signup | Anyone | Create new account |
| POST | /api/auth/login | Anyone | Login, get token |
| GET | /api/dashboard | All users | Get stats + activity |
| GET | /api/projects | All users | List all projects |
| POST | /api/projects | Admin only | Create project |
| DELETE | /api/projects/:id | Admin only | Delete project |
| GET | /api/tasks | All users | List tasks (filtered by role) |
| POST | /api/tasks | Admin only | Create and assign task |
| PATCH | /api/tasks/:id/status | Owner or Admin | Update task status |
| DELETE | /api/tasks/:id | Admin only | Delete task |
| GET | /api/members | Admin only | List all users |

---

## Demo accounts (seed these manually or signup)

After running the app, signup with:
- Admin: admin@demo.com / admin123 / role: admin
- Member: member@demo.com / member123 / role: member

---

## What makes this unique

The activity log — every action (task created, status updated, project deleted)
is written to the activity_log table and shown live on the dashboard as a feed.
This is what real tools like Jira and Asana have, and most beginner projects skip it.
