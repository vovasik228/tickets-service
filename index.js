const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const pool = require('./db');

const app = express();

// важно для Render
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// создаём папку uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// настройка загрузки
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

// главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// =======================
// АВТОРИЗАЦИЯ
// =======================

// регистрация
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1,$2) RETURNING id,email',
      [email, hash]
    );

    res.json(result.rows[0]);
  } catch (e) {
    res.status(400).send('Ошибка регистрации');
  }
});

// вход
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

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
    res.status(500).send('Ошибка входа');
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

// добавить объявление
app.post('/ads', async (req, res) => {
  try {
    const { title, price, user_id, image_url } = req.body;

    await pool.query(
      'INSERT INTO ads (title, price, user_id, image_url) VALUES ($1,$2,$3,$4)',
      [title, price, user_id || null, image_url || null]
    );

    res.send('OK');

  } catch (e) {
    res.status(500).send('Ошибка добавления');
  }
});

// получить объявления
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
    res.status(500).send('Ошибка загрузки');
  }
});

// удалить объявление
app.delete('/ads/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const result = await pool.query(
      'SELECT image_url FROM ads WHERE id = $1',
      [id]
    );

    if (result.rows.length > 0) {
      const image = result.rows[0].image_url;

      if (image && image.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, image);

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    await pool.query('DELETE FROM ads WHERE id = $1', [id]);

    res.send('Удалено');

  } catch (e) {
    res.status(500).send('Ошибка удаления');
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
        title TEXT,
        price INTEGER,
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


// =======================
// ЗАПУСК
// =======================

app.listen(PORT, () => {
  console.log('СЕРВЕР ЗАПУЩЕН');
});