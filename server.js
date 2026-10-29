require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const MIN_WITHDRAW_POINTS = Number(process.env.MIN_WITHDRAW_POINTS || 5000);
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("ERROR: Set JWT_SECRET to a random secret of at least 32 characters in .env");
  process.exit(1);
}
const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/earnsmart.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL,
 description TEXT NOT NULL,
 points_delta INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 method TEXT NOT NULL,
 account_masked TEXT NOT NULL,
 points INTEGER NOT NULL CHECK(points > 0),
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_claims (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 claim_date TEXT NOT NULL,
 UNIQUE(user_id, claim_date)
);
`);
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({ origin(origin, cb) {
  if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
  return cb(new Error("Origin not allowed by CORS"));
}}));
app.use(express.json({ limit: "20kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

const cleanEmail = s => String(s || "").trim().toLowerCase();
function tokenFor(user) {
  return jwt.sign({ sub: String(user.id), email: user.email }, JWT_SECRET, { expiresIn: "2h", issuer: "earnsmart-api", audience: "earnsmart-app" });
}
function auth(req, res, next) {
  const raw = req.headers.authorization || "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sign in required." });
  try {
    const p = jwt.verify(token, JWT_SECRET, { issuer: "earnsmart-api", audience: "earnsmart-app" });
    req.userId = Number(p.sub);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired or invalid. Sign in again." });
  }
}
const userById = db.prepare("SELECT id, email, points, created_at FROM users WHERE id = ?");
const activityInsert = db.prepare("INSERT INTO activity (user_id, kind, description, points_delta) VALUES (?, ?, ?, ?)");
const getPoints = db.prepare("SELECT points FROM users WHERE id = ?");

app.get("/api/health", (req, res) => res.json({ ok: true, service: "EarnSmart API", payoutsEnabled: false }));
app.post("/api/auth/register", rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 }), async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password must be 10–128 characters." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
    const user = userById.get(result.lastInsertRowid);
    return res.status(201).json({ token: tokenFor(user), user });
  } catch (e) {
    if (String(e.code).includes("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "An account with this email already exists." });
    console.error(e);
    return res.status(500).json({ error: "Could not create account." });
  }
});
app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res) => {
  const email = cleanEmail(req.body.email), password = String(req.body.password || "");
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: "Invalid email or password." });
  return res.json({ token: tokenFor(row), user: userById.get(row.id) });
});
app.get("/api/me", auth, (req, res) => {
  const user = userById.get(req.userId);
  if (!user) return res.status(404).json({ error: "Account not found." });
  res.json({ user });
});
app.get("/api/activity", auth, (req, res) => {
  const rows = db.prepare("SELECT kind, description, points_delta, created_at FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(req.userId);
  res.json({ activity: rows });
});
app.post("/api/daily-bonus", auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const claim = db.transaction(() => {
    const exists = db.prepare("SELECT id FROM daily_claims WHERE user_id = ? AND claim_date = ?").get(req.userId, today);
    if (exists) return { alreadyClaimed: true, points: getPoints.get(req.userId).points };
    db.prepare("INSERT INTO daily_claims (user_id, claim_date) VALUES (?, ?)").run(req.userId, today);
    db.prepare("UPDATE users SET points = points + 50 WHERE id = ?").run(req.userId);
    activityInsert.run(req.userId, "daily_bonus", "Daily bonus", 50);
    return { alreadyClaimed: false, points: getPoints.get(req.userId).points };
  });
  try {
    const result = claim();
    if (result.alreadyClaimed) return res.status(409).json({ error: "Daily bonus already claimed.", ...result });
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not claim bonus." }); }
});
app.post("/api/withdrawals", auth, (req, res) => {
  const method = String(req.body.method || "").trim();
  const account = String(req.body.account || "").trim();
  const points = Number(req.body.points);
  const methods = ["JazzCash", "Easypaisa", "Bank Transfer", "Other supported method"];
  if (!methods.includes(method)) return res.status(400).json({ error: "Unsupported payment method." });
  if (account.length < 5 || account.length > 80) return res.status(400).json({ error: "Enter a valid account or wallet identifier." });
  if (!Number.isSafeInteger(points) || points < MIN_WITHDRAW_POINTS) return res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAW_POINTS} points.` });
  const masked = account.length <= 4 ? "••••" : "••••" + account.slice(-4);
  try {
    const create = db.transaction(() => {
      const user = db.prepare("SELECT points FROM users WHERE id = ?").get(req.userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      if (user.points < points) throw new Error("INSUFFICIENT_POINTS");
      // Reserve points when creating the request; no payout is made by this API.
      db.prepare("UPDATE users SET points = points - ? WHERE id = ?").run(points, req.userId);
      const result = db.prepare("INSERT INTO withdrawals (user_id, method, account_masked, points) VALUES (?, ?, ?, ?)").run(req.userId, method, masked, points);
      activityInsert.run(req.userId, "withdrawal_pending", "Withdrawal request pending review", -points);
      return { id: Number(result.lastInsertRowid), status: "pending", method, accountMasked: masked, points };
    });
    const withdrawal = create();
    return res.status(201).json({ message: "Request recorded for manual review. No money has been sent.", withdrawal, payoutsEnabled: false });
  } catch (e) {
    if (e.message === "INSUFFICIENT_POINTS") return res.status(400).json({ error: "Not enough points." });
    if (e.message === "USER_NOT_FOUND") return res.status(404).json({ error: "Account not found." });
    console.error(e); return res.status(500).json({ error: "Could not create withdrawal request." });
  }
});
app.get("/api/withdrawals", auth, (req, res) => {
  const rows = db.prepare("SELECT id, method, account_masked, points, status, created_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(req.userId);
  res.json({ withdrawals: rows, payoutsEnabled: false });
});
app.use((err, req, res, next) => {
  if (err && err.message === "Origin not allowed by CORS") return res.status(403).json({ error: "Origin not allowed." });
  console.error(err);
  res.status(500).json({ error: "Unexpected server error." });
});
app.listen(PORT, () => console.log(`EarnSmart API listening on port ${PORT}`));
