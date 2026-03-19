const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const pool = require('./db');

const app = express();

app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safeOriginalName = file.originalname.replace(/\s+/g, '_');
    const uniqueName = Date.now() + '-' + safeOriginalName;
    cb(null, uniqueName);
  }
});

function fileFilter(req, file, cb) {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Можно загружать только JPG, PNG или WEBP'));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(400).send('Ошибка регистрации');
  }
});

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
  } catch (error) {
    res.status(500).send('Ошибка входа');
  }
});

app.post('/upload', (req, res) => {
  upload.single('image')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).send('Файл слишком большой. Максимум 5 МБ');
      }

      return res.status(400).send('Ошибка загрузки файла');
    }

    if (err) {
      return res.status(400).send(err.message);
    }

    if (!req.file) {
      return res.status(400).send('Файл не загружен');
    }

    res.json({
      image_url: '/uploads/' + req.file.filename
    });
  });
});

app.post('/ads', async (req, res) => {
  try {
    const { title, price, user_id, image_url } = req.body;

    await pool.query(
      'INSERT INTO ads (title, price, user_id, image_url) VALUES ($1, $2, $3, $4)',
      [title, price, user_id || null, image_url || null]
    );

    res.send('OK');
  } catch (error) {
    res.status(500).send('Ошибка добавления');
  }
});

app.get('/ads', async (req, res) => {
  try {
    const userId = req.query.user_id || null;

    let result;

    if (userId) {
      result = await pool.query(`
        SELECT 
          ads.id,
          ads.title,
          ads.price,
          ads.user_id,
          ads.image_url,
          users.email,
          CASE 
            WHEN favorites.id IS NOT NULL THEN true
            ELSE false
          END AS is_favorite
        FROM ads
        LEFT JOIN users ON ads.user_id = users.id
        LEFT JOIN favorites 
          ON ads.id = favorites.ad_id 
          AND favorites.user_id = $1
        ORDER BY ads.id DESC
      `, [userId]);
    } else {
      result = await pool.query(`
        SELECT 
          ads.id,
          ads.title,
          ads.price,
          ads.user_id,
          ads.image_url,
          users.email,
          false AS is_favorite
        FROM ads
        LEFT JOIN users ON ads.user_id = users.id
        ORDER BY ads.id DESC
      `);
    }

    res.json(result.rows);
  } catch (error) {
    res.status(500).send('Ошибка загрузки');
  }
});

app.post('/favorites', async (req, res) => {
  try {
    const { user_id, ad_id } = req.body;

    const existing = await pool.query(
      'SELECT * FROM favorites WHERE user_id = $1 AND ad_id = $2',
      [user_id, ad_id]
    );

    if (existing.rows.length > 0) {
      return res.send('Уже в избранном');
    }

    await pool.query(
      'INSERT INTO favorites (user_id, ad_id) VALUES ($1, $2)',
      [user_id, ad_id]
    );

    res.send('Добавлено в избранное');
  } catch (error) {
    res.status(500).send('Ошибка избранного');
  }
});

app.delete('/favorites', async (req, res) => {
  try {
    const { user_id, ad_id } = req.body;

    await pool.query(
      'DELETE FROM favorites WHERE user_id = $1 AND ad_id = $2',
      [user_id, ad_id]
    );

    res.send('Удалено из избранного');
  } catch (error) {
    res.status(500).send('Ошибка удаления из избранного');
  }
});

app.delete('/ads/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const result = await pool.query(
      'SELECT image_url FROM ads WHERE id = $1',
      [id]
    );

    if (result.rows.length > 0) {
      const imageUrl = result.rows[0].image_url;

      if (imageUrl && imageUrl.startsWith('/uploads/')) {
        const relativePath = imageUrl.replace('/uploads/', '');
        const filePath = path.join(uploadsDir, relativePath);

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    await pool.query('DELETE FROM ads WHERE id = $1', [id]);

    res.send('Удалено');
  } catch (error) {
    res.status(500).send('Ошибка удаления');
  }
});

// ===== ЧАТ =====

// отправить сообщение
app.post('/messages', async (req, res) => {
  try {
    const { from_user, to_user, text } = req.body;

    await pool.query(
      'INSERT INTO messages (from_user, to_user, text) VALUES ($1, $2, $3)',
      [from_user, to_user, text]
    );

    res.send('Сообщение отправлено');
  } catch (error) {
    res.status(500).send('Ошибка отправки сообщения');
  }
});

// получить переписку между двумя пользователями
app.get('/messages', async (req, res) => {
  try {
    const { user1, user2 } = req.query;

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
      ORDER BY id ASC
    `, [user1, user2]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).send('Ошибка загрузки сообщений');
  }
});

app.listen(5000, () => {
  console.log('СЕРВЕР ЗАПУЩЕН');
});