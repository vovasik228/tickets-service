const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// =======================
// MULTER
// =======================

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/\s+/g, '_');
    const uniqueName = Date.now() + '-' + safeName;
    cb(null, uniqueName);
  }
});

function fileFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Только JPG, PNG, WEBP'));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// =======================
// ГЛАВНАЯ
// =======================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// =======================
// АВТОРИЗАЦИЯ
// =======================

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send('Email и пароль обязательны');
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(400).send('Ошибка регистрации');
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send('Email и пароль обязательны');
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).send('Пользователь не найден');
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password);

    if (!ok) {
      return res.status(400).send('Неверный пароль');
    }

    res.json({
      id: user.id,
      email: user.email
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка входа');
  }
});

// =======================
// ПРОФИЛЬ
// =======================

app.get('/profile/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const result = await pool.query(
      'SELECT id, email FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Пользователь не найден');
    }

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка загрузки профиля');
  }
});

// =======================
// ЗАГРУЗКА ФОТО
// =======================

app.post('/upload', (req, res) => {
  upload.single('image')(req, res, function (err) {
    if (err) return res.status(400).send(err.message);

    if (!req.file) {
      return res.status(400).send('Файл не загружен');
    }

    res.json({
      image_url: '/uploads/' + req.file.filename
    });
  });
});

// =======================
// ОБЪЯВЛЕНИЯ
// =======================

app.post('/ads', async (req, res) => {
  try {
    const { title, price, user_id, image_url } = req.body;

    if (!title || !price) {
      return res.status(400).send('Название и цена обязательны');
    }

    await pool.query(
      'INSERT INTO ads (title, price, user_id, image_url) VALUES ($1, $2, $3, $4)',
      [title, price, user_id || null, image_url || null]
    );

    res.send('OK');
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка добавления');
  }
});

app.get('/ads', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ads.*, users.email
      FROM ads
      LEFT JOIN users ON ads.user_id = users.id
      ORDER BY ads.id DESC
    `);

    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка загрузки');
  }
});

app.get('/my-ads/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await pool.query(`
      SELECT ads.*, users.email
      FROM ads
      LEFT JOIN users ON ads.user_id = users.id
      WHERE ads.user_id = $1
      ORDER BY ads.id DESC
    `, [userId]);

    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка загрузки моих объявлений');
  }
});

app.delete('/ads/:id/:userId', async (req, res) => {
  try {
    const id = req.params.id;
    const userId = req.params.userId;

    const result = await pool.query(
      'SELECT * FROM ads WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Объявление не найдено');
    }

    const ad = result.rows[0];

    if (String(ad.user_id) !== String(userId)) {
      return res.status(403).send('Нельзя удалить чужое объявление');
    }

    if (ad.image_url && ad.image_url.startsWith('/uploads/')) {
      const relativePath = ad.image_url.replace('/uploads/', '');
      const filePath = path.join(uploadsDir, relativePath);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await pool.query('DELETE FROM ads WHERE id = $1', [id]);

    res.send('Удалено');
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка удаления');
  }
});

// =======================
// ЧАТ
// =======================

// отправить сообщение
app.post('/messages', async (req, res) => {
  try {
    const { from_user, to_user, text } = req.body;

    if (!from_user || !to_user || !text) {
      return res.status(400).send('Не хватает данных');
    }

    await pool.query(
      'INSERT INTO messages (from_user, to_user, text) VALUES ($1, $2, $3)',
      [from_user, to_user, text]
    );

    res.send('Сообщение отправлено');
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка отправки сообщения');
  }
});

// получить диалог между двумя пользователями
app.get('/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;

    const result = await pool.query(`
      SELECT 
        messages.*,
        u1.email AS from_email,
        u2.email AS to_email
      FROM messages
      LEFT JOIN users u1 ON messages.from_user = u1.id
      LEFT JOIN users u2 ON messages.to_user = u2.id
      WHERE 
        (from_user = $1 AND to_user = $2)
        OR
        (from_user = $2 AND to_user = $1)
      ORDER BY messages.id ASC
    `, [user1, user2]);

    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка загрузки сообщений');
  }
});

// список диалогов пользователя
app.get('/dialogs/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await pool.query(`
      SELECT DISTINCT
        CASE
          WHEN from_user = $1 THEN to_user
          ELSE from_user
        END AS companion_id,
        CASE
          WHEN from_user = $1 THEN u2.email
          ELSE u1.email
        END AS companion_email
      FROM messages
      LEFT JOIN users u1 ON messages.from_user = u1.id
      LEFT JOIN users u2 ON messages.to_user = u2.id
      WHERE from_user = $1 OR to_user = $1
    `, [userId]);

    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка загрузки диалогов');
  }
});

// =======================
// СОЗДАНИЕ БАЗЫ
// =======================

app.get('/init-db', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ads (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        price INTEGER NOT NULL,
        user_id INTEGER,
        image_url TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        ad_id INTEGER
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        from_user INTEGER,
        to_user INTEGER,
        text TEXT
      );
    `);

    res.send('DB CREATED');
  } catch (e) {
    console.error(e);
    res.status(500).send('Ошибка создания БД');
  }
});

app.listen(PORT, () => {
  console.log('СЕРВЕР ЗАПУЩЕН НА ПОРТУ', PORT);
});