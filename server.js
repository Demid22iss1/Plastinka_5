// @ts-nocheck
const express = require("express");
const Database = require("better-sqlite3");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const app = express();

// Инициализация базы данных
const db = new Database("./database.sqlite");

// Настройки PRAGMA для better-sqlite3
db.pragma('encoding = "UTF-8"');
db.pragma('case_sensitive_like = OFF');
db.pragma('journal_mode = WAL');

console.log("✅ База данных подключена");

// ============================================================
// НАСТРОЙКИ MIDDLEWARE
// ============================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: "plastinka-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Требуется авторизация' });
        return res.redirect("/login");
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "admin") {
        return res.status(403).send('<h1>Доступ запрещен</h1><a href="/">На главную</a>');
    }
    next();
};

app.use((req, res, next) => {
    req.isMobile = /mobile|android|iphone|ipad|phone/i.test(req.headers['user-agent'] || '');
    next();
});

// ============================================================
// ПАПКИ
// ============================================================
const uploadDirs = ['public/uploads', 'public/audio', 'public/photo', 'public/avatars'];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

// ============================================================
// ТАБЛИЦЫ
// ============================================================
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

// Тестовые данные
const playersCount = db.prepare("SELECT COUNT(*) as count FROM players").get();
if (playersCount.count === 0) {
    const ins = db.prepare("INSERT INTO players (name, price, image, description) VALUES (?, ?, ?, ?)");
    ins.run('Pro-Ject Debut Carbon', 499, 'proigrvatel1.png', 'Высококачественный проигрыватель винила');
    ins.run('Audio-Technica AT-LP120', 299, 'proigrvatel2.png', 'Профессиональный проигрыватель');
    ins.run('Rega Planar 3', 899, 'proigrvatel3.png', 'Легендарный британский проигрыватель');
}

const productsCount = db.prepare("SELECT COUNT(*) as count FROM products").get();
if (productsCount.count === 0) {
    const ins = db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    ins.run('Dark Side of the Moon', 'Pink Floyd', 35, 'dark-side.png', null, 'Легендарный альбом', 'Rock', '1973');
    ins.run('Abbey Road', 'The Beatles', 40, 'abbey-road.png', null, 'Последний альбом', 'Rock', '1969');
    ins.run('Thriller', 'Michael Jackson', 45, 'thriller.png', null, 'Самый продаваемый', 'Pop', '1982');
}

const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE username = ?").get('admin');
if (adminCount.count === 0) {
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run('admin', bcrypt.hashSync('admin123', 10), 'admin');
}

// ============================================================
// TELEGRAM AUTH
// ============================================================
app.post("/api/telegram-auth", express.json(), (req, res) => {
    const { id, username } = req.body;
    if (!id) return res.json({ success: false });
    try {
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
    } catch (err) {
        res.json({ success: false });
    }
});

// ============================================================
// API
// ============================================================
app.post("/api/upload-avatar", requireAuth, upload.single("avatar"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Нет файла" });
    try {
        db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(req.file.filename, req.session.user.id);
        req.session.user.avatar = req.file.filename;
        res.json({ success: true, avatar: `/avatars/${req.file.filename}` });
    } catch (err) {
        res.status(500).json({ error: "Ошибка" });
    }
});

app.get("/api/favorites/status/:productId", requireAuth, (req, res) => {
    try {
        const fav = db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?").get(req.session.user.id, req.params.productId);
        res.json({ isFavorite: !!fav });
    } catch (err) {
        res.json({ isFavorite: false });
    }
});

app.get("/api/favorites/count", requireAuth, (req, res) => {
    try {
        const cnt = db.prepare("SELECT COUNT(*) as count FROM favorites WHERE user_id = ?").get(req.session.user.id);
        res.json({ count: cnt?.count || 0 });
    } catch (err) {
        res.json({ count: 0 });
    }
});

app.post("/api/favorites/toggle", requireAuth, express.json(), (req, res) => {
    const { id } = req.body;
    const userId = req.session.user.id;
    try {
        const fav = db.prepare("SELECT * FROM favorites WHERE user_id = ? AND product_id = ?").get(userId, id);
        if (fav) {
            db.prepare("DELETE FROM favorites WHERE user_id = ? AND product_id = ?").run(userId, id);
            res.json({ action: "removed" });
        } else {
            db.prepare("INSERT INTO favorites (user_id, product_id) VALUES (?, ?)").run(userId, id);
            res.json({ action: "added" });
        }
    } catch (err) {
        res.status(500).json({ error: "Ошибка" });
    }
});

app.post("/api/cart/add", requireAuth, (req, res) => {
    const { id } = req.body;
    const userId = req.session.user.id;
    try {
        const existing = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(userId, id);
        if (existing) {
            db.prepare("UPDATE carts SET quantity = quantity + 1 WHERE user_id = ? AND product_id = ?").run(userId, id);
        } else {
            db.prepare("INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)").run(userId, id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Ошибка" });
    }
});

app.get("/api/rating/:productId", (req, res) => {
    try {
        const data = db.prepare("SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?").get(req.params.productId);
        res.json({ avg_rating: data?.avg_rating || 0, votes_count: data?.votes_count || 0 });
    } catch (err) {
        res.json({ avg_rating: 0, votes_count: 0 });
    }
});

app.post("/api/rating/:productId", requireAuth, express.json(), (req, res) => {
    const { rating, comment } = req.body;
    const productId = req.params.productId;
    const userId = req.session.user.id;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: "Оценка от 1 до 5" });
    try {
        db.prepare(`INSERT INTO ratings (user_id, product_id, rating, comment, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, product_id) DO UPDATE SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP`)
            .run(userId, productId, rating, comment || null, rating, comment || null);
        const result = db.prepare("SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?").get(productId);
        res.json({ success: true, avg_rating: result?.avg_rating || 0, votes_count: result?.votes_count || 0 });
    } catch (err) {
        res.status(500).json({ error: "Ошибка" });
    }
});

app.get("/api/search", (req, res) => {
    const query = req.query.q || '';
    if (query.length < 1) return res.json({ results: [] });
    const pattern = `%${query}%`;
    try {
        const products = db.prepare(`SELECT id, name, artist, price, image, audio, description, genre, year, 'product' as type FROM products WHERE name LIKE ? OR artist LIKE ? LIMIT 10`).all(pattern, pattern);
        const players = db.prepare(`SELECT id, name, 'Проигрыватель' as artist, price, image, description, 'player' as type FROM players WHERE name LIKE ? LIMIT 5`).all(pattern);
        res.json({ results: [...products, ...players] });
    } catch (err) {
        res.json({ results: [] });
    }
});

// ============================================================
// ГЛАВНАЯ
// ============================================================
app.get("/", (req, res) => {
    try {
        const products = db.prepare("SELECT * FROM products ORDER BY id DESC LIMIT 6").all();
        const players = db.prepare("SELECT * FROM players").all();
        
        let productHTML = "";
        products.forEach(p => {
            productHTML += `<div class="product"><img src="/uploads/${p.image}"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.artist)}</p><p>$${p.price}</p><form action="/add-to-cart" method="POST"><input type="hidden" name="id" value="product_${p.id}"><button type="submit">В корзину</button></form></div>`;
        });
        
        res.send(`
<!DOCTYPE html>
<html>
<head><title>Plastinka</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{background:#0f0f0f;color:#fff;font-family:sans-serif;margin:0;padding:20px}
.header{display:flex;justify-content:space-between;align-items:center;padding:10px 20px;background:#000;margin-bottom:20px}
.products{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px}
.product{background:#1a1a1a;padding:15px;border-radius:10px;text-align:center}
.product img{width:100%;border-radius:8px}
button{background:#ff4444;color:#fff;border:none;padding:8px 16px;border-radius:5px;cursor:pointer}
a{color:#ff4444;text-decoration:none}
.nav{display:flex;gap:20px;align-items:center}
</style></head>
<body>
<div class="header">
    <img src="/photo/logo.svg" height="40">
    <div class="nav">
        <a href="/">Главная</a>
        <a href="/catalog">Каталог</a>
        ${req.session.user ? `<a href="/profile">${escapeHtml(req.session.user.username)}</a><a href="/logout">Выйти</a>` : `<a href="/login">Войти</a>`}
        <a href="/cart">🛒 Корзина</a>
    </div>
</div>
<h1>Новинки</h1>
<div class="products">${productHTML}</div>
</body></html>
        `);
    } catch (err) {
        res.status(500).send("Ошибка");
    }
});

// ============================================================
// КАТАЛОГ
// ============================================================
app.get("/catalog", (req, res) => {
    try {
        const products = db.prepare("SELECT * FROM products ORDER BY id DESC").all();
        let html = '<!DOCTYPE html><html><head><title>Каталог</title><style>body{background:#0f0f0f;color:#fff;padding:20px}.products{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px}.product{background:#1a1a1a;padding:15px;border-radius:10px;text-align:center}.product img{width:100%;border-radius:8px}button{background:#ff4444;color:#fff;border:none;padding:8px 16px;border-radius:5px}</style></head><body><a href="/">← На главную</a><h1>Каталог</h1><div class="products">';
        products.forEach(p => {
            html += `<div class="product"><img src="/uploads/${p.image}"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.artist)}</p><p>$${p.price}</p><form action="/add-to-cart" method="POST"><input type="hidden" name="id" value="product_${p.id}"><button type="submit">В корзину</button></form></div>`;
        });
        html += '</div></body></html>';
        res.send(html);
    } catch (err) {
        res.status(500).send("Ошибка");
    }
});

// ============================================================
// АВТОРИЗАЦИЯ
// ============================================================
app.get("/login", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.send(`<!DOCTYPE html><html><head><title>Вход</title><style>body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;height:100vh}</style></head><body><div style="background:#1a1a1a;padding:40px;border-radius:16px"><h2>Вход</h2>${req.query.error ? '<p style="color:red">Ошибка</p>' : ''}<form method="POST"><input type="text" name="username" placeholder="Логин" required><br><input type="password" name="password" placeholder="Пароль" required><br><button type="submit">Войти</button></form><a href="/register">Регистрация</a><a href="/">На главную</a></div></body></html>`);
});

app.post("/login", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.body.username);
    if (user && bcrypt.compareSync(req.body.password, user.password)) {
        req.session.user = { id: user.id, username: user.username, role: user.role, avatar: user.avatar };
        res.redirect("/");
    } else {
        res.redirect("/login?error=1");
    }
});

app.get("/register", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.send(`<!DOCTYPE html><html><head><title>Регистрация</title><style>body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;height:100vh}</style></head><body><div style="background:#1a1a1a;padding:40px;border-radius:16px"><h2>Регистрация</h2>${req.query.error === 'exists' ? '<p style="color:red">Пользователь существует</p>' : ''}<form method="POST"><input type="text" name="username" placeholder="Логин" required><br><input type="password" name="password" placeholder="Пароль" required><br><button type="submit">Зарегистрироваться</button></form><a href="/login">Вход</a><a href="/">На главную</a></div></body></html>`);
});

app.post("/register", (req, res) => {
    const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(req.body.username);
    if (existing) return res.redirect("/register?error=exists");
    const hash = bcrypt.hashSync(req.body.password, 10);
    db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run(req.body.username, hash, "user");
    res.redirect("/login");
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// ============================================================
// КОРЗИНА
// ============================================================
app.post("/add-to-cart", requireAuth, (req, res) => {
    const userId = req.session.user.id;
    const productId = req.body.id;
    const existing = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(userId, productId);
    if (existing) {
        db.prepare("UPDATE carts SET quantity = quantity + 1 WHERE user_id = ? AND product_id = ?").run(userId, productId);
    } else {
        db.prepare("INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)").run(userId, productId);
    }
    res.redirect(req.headers.referer || "/");
});

app.get("/cart", requireAuth, (req, res) => {
    const cartItems = db.prepare("SELECT * FROM carts WHERE user_id = ?").all(req.session.user.id);
    if (!cartItems.length) return res.send("<h1>Корзина пуста</h1><a href='/catalog'>В каталог</a>");
    let html = '<h1>Корзина</h1>';
    let total = 0;
    for (const item of cartItems) {
        const id = item.product_id.replace('product_', '');
        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
        if (product) {
            total += product.price * item.quantity;
            html += `<div><img src="/uploads/${product.image}" width="50"><b>${escapeHtml(product.name)}</b> - ${escapeHtml(product.artist)} - $${product.price} x ${item.quantity} = $${product.price * item.quantity}<br><button onclick="updateCart('${item.product_id}', 'decrease')">-</button> ${item.quantity} <button onclick="updateCart('${item.product_id}', 'increase')">+</button> <button onclick="removeFromCart('${item.product_id}')">Удалить</button></div><hr>`;
        }
    }
    html += `<h2>Итого: $${total}</h2><button onclick="alert('Заказ оформлен')">Оформить</button>
    <script>
    function updateCart(id, action) {
        fetch('/api/cart/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: id, action: action }) }).then(() => location.reload());
    }
    function removeFromCart(id) {
        fetch('/api/cart/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: id }) }).then(() => location.reload());
    }
    </script>`;
    res.send(html);
});

app.post("/api/cart/update", requireAuth, (req, res) => {
    const { product_id, action } = req.body;
    const userId = req.session.user.id;
    const cartItem = db.prepare("SELECT * FROM carts WHERE user_id = ? AND product_id = ?").get(userId, product_id);
    if (!cartItem) return res.status(404).json({ error: "Not found" });
    let newQty = cartItem.quantity;
    if (action === 'increase') newQty++;
    else if (action === 'decrease') newQty--;
    if (newQty <= 0) {
        db.prepare("DELETE FROM carts WHERE user_id = ? AND product_id = ?").run(userId, product_id);
    } else {
        db.prepare("UPDATE carts SET quantity = ? WHERE user_id = ? AND product_id = ?").run(newQty, userId, product_id);
    }
    res.json({ success: true });
});

app.post("/api/cart/remove", requireAuth, (req, res) => {
    const { product_id } = req.body;
    const userId = req.session.user.id;
    db.prepare("DELETE FROM carts WHERE user_id = ? AND product_id = ?").run(userId, product_id);
    res.json({ success: true });
});

// ============================================================
// ПРОФИЛЬ
// ============================================================
app.get("/profile", requireAuth, (req, res) => {
    res.send(`<h1>Профиль: ${escapeHtml(req.session.user.username)}</h1><p>Роль: ${req.session.user.role}</p><a href="/logout">Выйти</a><br><a href="/">На главную</a>`);
});

// ============================================================
// ЗАПУСК
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`👤 Admin: admin / admin123`);
});

module.exports = app;