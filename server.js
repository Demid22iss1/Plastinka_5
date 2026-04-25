// @ts-nocheck
const express = require("express");
const Database = require("better-sqlite3");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const app = express();
const db = new Database("./database.sqlite");

// PRAGMA настройки
db.pragma('encoding = "UTF-8"');
db.pragma('case_sensitive_like = OFF');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: "plastinka-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Helper functions
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
        return res.redirect("/login");
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "admin") {
        return res.status(403).send("Access denied");
    }
    next();
}

app.use((req, res, next) => {
    req.isMobile = /mobile|android|iphone|ipad|phone/i.test(req.headers['user-agent'] || '');
    next();
});

// Create upload directories
const uploadDirs = ['public/uploads', 'public/audio', 'public/photo', 'public/avatars'];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === "image" || file.fieldname === "product_image") cb(null, "public/uploads/");
        else if (file.fieldname === "player_image") cb(null, "public/photo/");
        else if (file.fieldname === "avatar") cb(null, "public/avatars/");
        else cb(null, "public/audio/");
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ========== CREATE TABLES ==========
db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, artist TEXT, price REAL, image TEXT, audio TEXT,
    description TEXT, genre TEXT, year TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, price REAL, image TEXT, description TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user',
    avatar TEXT DEFAULT 'default-avatar.png', telegram_id INTEGER UNIQUE
)`);

db.exec(`CREATE TABLE IF NOT EXISTS carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, product_id TEXT, quantity INTEGER DEFAULT 1,
    UNIQUE(user_id, product_id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, product_id TEXT, UNIQUE(user_id, product_id)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT)`);

db.exec(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, product_id INTEGER, rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    admin_reply TEXT, admin_reply_at DATETIME,
    UNIQUE(user_id, product_id)
)`);

console.log("✅ Tables created");

// ========== SEED DATA ==========
const homepageSetting = db.prepare("SELECT COUNT(*) as count FROM site_settings WHERE key = ?").get('homepage_products');
if (homepageSetting.count === 0) {
    db.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?)").run('homepage_products', 'last_added');
}

const playersCount = db.prepare("SELECT COUNT(*) as count FROM players").get();
if (playersCount.count === 0) {
    const insert = db.prepare("INSERT INTO players (name, price, image, description) VALUES (?, ?, ?, ?)");
    insert.run('Pro-Ject Debut Carbon', 499, 'proigrvatel1.png', 'High-quality turntable');
    insert.run('Audio-Technica AT-LP120', 299, 'proigrvatel2.png', 'Professional turntable');
    insert.run('Rega Planar 3', 899, 'proigrvatel3.png', 'Legendary British turntable');
    console.log("✅ Players seeded");
}

const productsCount = db.prepare("SELECT COUNT(*) as count FROM products").get();
if (productsCount.count === 0) {
    const insert = db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run('Dark Side of the Moon', 'Pink Floyd', 35, 'dark-side.png', null, 'Legendary album', 'Rock', '1973');
    insert.run('Abbey Road', 'The Beatles', 40, 'abbey-road.png', null, 'Last recorded album', 'Rock', '1969');
    insert.run('Thriller', 'Michael Jackson', 45, 'thriller.png', null, 'Best-selling album', 'Pop', '1982');
    console.log("✅ Products seeded");
}

const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE username = ?").get('admin');
if (adminCount.count === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("admin", hash, "admin");
    console.log("✅ Admin user created");
}

// ========== TELEGRAM AUTH ==========
app.post("/api/telegram-auth", express.json(), (req, res) => {
    const { id, username } = req.body;
    if (!id) return res.json({ success: false });
    
    let user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(id);
    if (user) {
        req.session.user = user;
        return res.json({ success: true, isNew: false });
    }
    
    const newUsername = username || `tg_${id}`;
    const result = db.prepare("INSERT INTO users (username, password, role, telegram_id, avatar) VALUES (?, ?, 'user', ?, ?)")
        .run(newUsername, Math.random().toString(36), id, 'default-avatar.png');
    
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
    req.session.user = user;
    res.json({ success: true, isNew: true });
});

// ========== SIMPLE ROUTES FOR TEST ==========
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Plastinka</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="background:#0f0f0f; color:white; font-family:sans-serif; text-align:center; padding:50px;">
            <h1>🎵 Plastinka</h1>
            <p>Server is running!</p>
            <p>Admin: admin / admin123</p>
            <a href="/login" style="color:#ff4444">Login</a> | 
            <a href="/catalog" style="color:#ff4444">Catalog</a>
        </body>
        </html>
    `);
});

app.get("/login", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Login</title></head>
        <body style="background:#0f0f0f; color:white; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
            <div style="background:#1a1a1a; padding:40px; border-radius:16px;">
                <h2>Login</h2>
                ${req.query.error ? '<p style="color:red">Invalid credentials</p>' : ''}
                <form method="POST">
                    <input type="text" name="username" placeholder="Username" required style="display:block; margin:10px 0; padding:10px; width:250px;">
                    <input type="password" name="password" placeholder="Password" required style="display:block; margin:10px 0; padding:10px; width:250px;">
                    <button type="submit" style="background:#ff4444; color:white; padding:10px 20px; border:none; border-radius:8px;">Login</button>
                </form>
                <a href="/register" style="color:#ff4444">Register</a>
            </div>
        </body>
        </html>
    `);
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (user && bcrypt.compareSync(password, user.password)) {
        req.session.user = user;
        res.redirect("/");
    } else {
        res.redirect("/login?error=1");
    }
});

app.get("/register", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Register</title></head>
        <body style="background:#0f0f0f; color:white; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
            <div style="background:#1a1a1a; padding:40px; border-radius:16px;">
                <h2>Register</h2>
                <form method="POST">
                    <input type="text" name="username" placeholder="Username" required style="display:block; margin:10px 0; padding:10px; width:250px;">
                    <input type="password" name="password" placeholder="Password" required style="display:block; margin:10px 0; padding:10px; width:250px;">
                    <button type="submit" style="background:#ff4444; color:white; padding:10px 20px; border:none; border-radius:8px;">Register</button>
                </form>
                <a href="/login" style="color:#ff4444">Back to Login</a>
            </div>
        </body>
        </html>
    `);
});

app.post("/register", (req, res) => {
    const { username, password } = req.body;
    const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (existing) return res.redirect("/register?error=1");
    
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'user')").run(username, hash);
    res.redirect("/login?registered=1");
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// ========== BASIC API ==========
app.get("/api/products", (req, res) => {
    const products = db.prepare("SELECT * FROM products ORDER BY id DESC").all();
    res.json(products);
});

app.get("/api/cart", requireAuth, (req, res) => {
    const items = db.prepare(`
        SELECT c.*, p.name, p.artist, p.price, p.image 
        FROM carts c JOIN products p ON c.product_id = p.id 
        WHERE c.user_id = ?
    `).all(req.session.user.id);
    res.json({ items });
});

app.post("/api/cart/add", requireAuth, express.json(), (req, res) => {
    const { product_id } = req.body;
    const userId = req.session.user.id;
    
    const existing = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(userId, product_id);
    if (existing) {
        db.prepare("UPDATE carts SET quantity = quantity + 1 WHERE user_id = ? AND product_id = ?").run(userId, product_id);
    } else {
        db.prepare("INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)").run(userId, product_id);
    }
    res.json({ success: true });
});

app.get("/api/favorites", requireAuth, (req, res) => {
    const items = db.prepare(`
        SELECT f.*, p.name, p.artist, p.price, p.image 
        FROM favorites f JOIN products p ON f.product_id = p.id 
        WHERE f.user_id = ?
    `).all(req.session.user.id);
    res.json(items);
});

app.post("/api/favorites/toggle", requireAuth, express.json(), (req, res) => {
    const { product_id } = req.body;
    const userId = req.session.user.id;
    
    const existing = db.prepare("SELECT * FROM favorites WHERE user_id = ? AND product_id = ?").get(userId, product_id);
    if (existing) {
        db.prepare("DELETE FROM favorites WHERE user_id = ? AND product_id = ?").run(userId, product_id);
        res.json({ action: "removed" });
    } else {
        db.prepare("INSERT INTO favorites (user_id, product_id) VALUES (?, ?)").run(userId, product_id);
        res.json({ action: "added" });
    }
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`👤 Admin: admin / admin123`);
});