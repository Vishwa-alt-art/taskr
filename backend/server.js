// ============================================
// server.js — The brain of our app
// This is ONE file that does everything:
// - Starts a web server
// - Handles login/signup
// - Manages projects, tasks, members
// - Saves everything to PostgreSQL
// ============================================

const express = require('express')        // express = the web server framework
const cors = require('cors')             // cors = allows our frontend to talk to backend
const bcrypt = require('bcryptjs')       // bcrypt = hashes passwords (never store plain text!)
const jwt = require('jsonwebtoken')      // jwt = creates login tokens (like a digital ID card)
const { Pool } = require('pg')           // pg = talks to PostgreSQL database
require('dotenv').config()               // dotenv = reads our .env file

const app = express()
const PORT = process.env.PORT || 5000

// ── Middleware (runs on every request) ──────────────────────────
app.use(cors())                          // allow all origins (fine for dev/railway)
app.use(express.json()) 
const path = require('path')
app.use(express.static(path.join(__dirname, '.')))                 // parse JSON bodies from requests

// ── Database connection ──────────────────────────────────────────
// Railway gives us a DATABASE_URL automatically when we add PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
})

// ── Create all tables on startup ────────────────────────────────
// This runs when server starts. IF the tables already exist, it skips them.
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'member',   -- 'admin' or 'member'
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      status VARCHAR(30) DEFAULT 'todo',   -- 'todo', 'inprogress', 'done'
      priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high'
      due_date DATE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      assigned_to INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      user_name VARCHAR(100),
      action TEXT NOT NULL,               -- e.g. "created task Design the logo"
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)
  console.log('✅ Database tables ready')
}

// ── JWT helper — checks if user is logged in ────────────────────
// Every protected route calls this first
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization  // "Bearer <token>"
  if (!authHeader) return res.status(401).json({ error: 'No token — please login' })

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded   // attach user info to the request
    next()               // continue to the actual route
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ── Admin-only guard ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admins only' })
  }
  next()
}

// ── Helper: log an activity ─────────────────────────────────────
async function logActivity(userId, userName, action) {
  await pool.query(
    'INSERT INTO activity_log (user_id, user_name, action) VALUES ($1, $2, $3)',
    [userId, userName, action]
  )
}

// ════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════

// POST /api/auth/signup — Create a new account
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, role } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' })
  }

  // Check if email already exists
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'Email already registered' })
  }

  // Hash the password — never store plain text passwords!
  const hashed = await bcrypt.hash(password, 10)

  // Save user to DB
  const result = await pool.query(
    'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
    [name, email, hashed, role || 'member']
  )

  const user = result.rows[0]

  // Create a JWT token (expires in 7 days)
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  await logActivity(user.id, user.name, 'joined the team')
  res.json({ token, user })
})

// POST /api/auth/login — Login with existing account
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Email not found' })
  }

  const user = result.rows[0]

  // Compare entered password with hashed password in DB
  const match = await bcrypt.compare(password, user.password)
  if (!match) return res.status(401).json({ error: 'Wrong password' })

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } })
})

// ════════════════════════════════════════════════════════════════
// DASHBOARD ROUTE
// ════════════════════════════════════════════════════════════════

// GET /api/dashboard — Summary numbers for the dashboard
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const userId = req.user.id
  const isAdmin = req.user.role === 'admin'

  // Admins see all tasks, members see only their own
  const taskFilter = isAdmin ? '' : 'WHERE assigned_to = $1'
  const params = isAdmin ? [] : [userId]

  const tasks = await pool.query(
    `SELECT status, due_date FROM tasks ${taskFilter}`, params
  )

  const all = tasks.rows
  const today = new Date().toISOString().split('T')[0]

  const stats = {
    total: all.length,
    todo: all.filter(t => t.status === 'todo').length,
    inprogress: all.filter(t => t.status === 'inprogress').length,
    done: all.filter(t => t.status === 'done').length,
    overdue: all.filter(t => t.due_date && t.due_date.toISOString().split('T')[0] < today && t.status !== 'done').length
  }

  // Recent activity (last 10)
  const activity = await pool.query(
    'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10'
  )

  res.json({ stats, activity: activity.rows })
})

// ════════════════════════════════════════════════════════════════
// PROJECT ROUTES
// ════════════════════════════════════════════════════════════════

// GET /api/projects — List all projects
app.get('/api/projects', requireAuth, async (req, res) => {
  const result = await pool.query(`
    SELECT p.*, u.name as creator_name,
      COUNT(t.id) as task_count
    FROM projects p
    LEFT JOIN users u ON p.created_by = u.id
    LEFT JOIN tasks t ON t.project_id = p.id
    GROUP BY p.id, u.name
    ORDER BY p.created_at DESC
  `)
  res.json(result.rows)
})

// POST /api/projects — Create a project (Admin only)
app.post('/api/projects', requireAuth, requireAdmin, async (req, res) => {
  const { name, description } = req.body
  if (!name) return res.status(400).json({ error: 'Project name is required' })

  const result = await pool.query(
    'INSERT INTO projects (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
    [name, description, req.user.id]
  )

  await logActivity(req.user.id, req.user.name, `created project "${name}"`)
  res.json(result.rows[0])
})

// DELETE /api/projects/:id — Delete project (Admin only)
app.delete('/api/projects/:id', requireAuth, requireAdmin, async (req, res) => {
  const proj = await pool.query('SELECT name FROM projects WHERE id = $1', [req.params.id])
  await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id])
  await logActivity(req.user.id, req.user.name, `deleted project "${proj.rows[0]?.name}"`)
  res.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// TASK ROUTES
// ════════════════════════════════════════════════════════════════

// GET /api/tasks — List tasks (filtered by role)
app.get('/api/tasks', requireAuth, async (req, res) => {
  const { project_id } = req.query
  const isAdmin = req.user.role === 'admin'

  let query = `
    SELECT t.*, 
      u.name as assigned_name,
      p.name as project_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE 1=1
  `
  const params = []

  // Members only see their own tasks
  if (!isAdmin) {
    params.push(req.user.id)
    query += ` AND t.assigned_to = $${params.length}`
  }

  if (project_id) {
    params.push(project_id)
    query += ` AND t.project_id = $${params.length}`
  }

  query += ' ORDER BY t.created_at DESC'

  const result = await pool.query(query, params)
  res.json(result.rows)
})

// POST /api/tasks — Create a task (Admin only)
app.post('/api/tasks', requireAuth, requireAdmin, async (req, res) => {
  const { title, description, project_id, assigned_to, due_date, priority } = req.body
  if (!title || !project_id) return res.status(400).json({ error: 'Title and project are required' })

  const result = await pool.query(
    `INSERT INTO tasks (title, description, project_id, assigned_to, due_date, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [title, description, project_id, assigned_to, due_date, priority || 'medium', req.user.id]
  )

  // Who is it assigned to?
  let assigneeName = 'nobody'
  if (assigned_to) {
    const u = await pool.query('SELECT name FROM users WHERE id = $1', [assigned_to])
    assigneeName = u.rows[0]?.name || 'someone'
  }

  await logActivity(req.user.id, req.user.name, `created task "${title}" → assigned to ${assigneeName}`)
  res.json(result.rows[0])
})

// PATCH /api/tasks/:id/status — Update task status (Member or Admin)
app.patch('/api/tasks/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body
  const validStatuses = ['todo', 'inprogress', 'done']
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })

  // Members can only update tasks assigned to them
  const task = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id])
  if (task.rows.length === 0) return res.status(404).json({ error: 'Task not found' })

  if (req.user.role !== 'admin' && task.rows[0].assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'You can only update your own tasks' })
  }

  await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [status, req.params.id])

  const label = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' }
  await logActivity(req.user.id, req.user.name, `moved "${task.rows[0].title}" → ${label[status]}`)

  res.json({ success: true })
})

// DELETE /api/tasks/:id — Delete task (Admin only)
app.delete('/api/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
  const task = await pool.query('SELECT title FROM tasks WHERE id = $1', [req.params.id])
  await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id])
  await logActivity(req.user.id, req.user.name, `deleted task "${task.rows[0]?.title}"`)
  res.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// MEMBERS ROUTE
// ════════════════════════════════════════════════════════════════

// GET /api/members — List all users (Admin only)
app.get('/api/members', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC'
  )
  res.json(result.rows)
})

// ── Start the server ─────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
  })
})
