
import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { Client } from 'ssh2';

const app = express();
const port = 80;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const projectRoot = process.cwd();

app.post('/api/fs', (req, res) => {
  const { path: relativePath, content } = req.body;

  if (!relativePath || typeof relativePath !== 'string' || content === undefined) {
    return res.status(400).send({ message: 'Некорректный запрос: требуются путь и контент файла.' });
  }

  const targetPath = path.resolve(projectRoot, relativePath);

  if (!targetPath.startsWith(projectRoot)) {
    return res.status(403).send({ message: 'Запрещено: путь выходит за пределы разрешенной директории.' });
  }

  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(targetPath, content, 'utf8');
    
    console.log(`[OK] Файл записан: ${relativePath}`);
    res.status(200).send({ message: `Файл ${relativePath} успешно сохранен.` });
  } catch (error) {
    console.error(`[ОШИБКА] Не удалось записать файл: ${relativePath}`, error);
    res.status(500).send({ message: 'Ошибка при записи файла.', error: error.message });
  }
});

// Новый роут для удаленного деплоя
app.post('/api/deploy-remote', (req, res) => {
  const { host, username, password } = req.body;

  if (!host || !username || !password) {
    return res.status(400).json({ message: 'Необходимы хост, имя пользователя и пароль.', logs: [] });
  }

  const conn = new Client();
  const command = 'cd /root && npm install && npm install -g pm2 && pm2 restart muravey-backend || pm2 start server.js --name "muravey-backend" --watch';
  const outputArray = [];
  
  conn.on('ready', () => {
    outputArray.push('✅ SSH-соединение установлено.');
    console.log('SSH-соединение установлено.');
    conn.exec(command, (err, stream) => {
      if (err) {
        outputArray.push(`❌ Ошибка выполнения команды: ${err.message}`);
        console.error('Ошибка выполнения команды:', err);
        return res.status(500).json({ message: 'Ошибка выполнения команды на сервере.', error: err.message, logs: outputArray });
      }

      stream.on('close', (code) => {
        outputArray.push(`🏁 Команда завершена с кодом: ${code}`);
        console.log('Команда завершена с кодом:', code);
        conn.end();
        if (code === 0) {
          res.status(200).json({ message: 'Сервер на Рег.облаке успешно запущен/перезапущен.', logs: outputArray });
        } else {
          res.status(500).json({ message: `Команда завершилась с ошибкой (код: ${code}).`, logs: outputArray });
        }
      }).on('data', (data) => {
        const chunk = data.toString().trim();
        outputArray.push(chunk);
        console.log('STDOUT:', chunk);
      }).stderr.on('data', (data) => {
        const chunk = data.toString().trim();
        outputArray.push(`[STDERR] ${chunk}`);
        console.error('STDERR:', chunk);
      });
    });
  }).on('error', (err) => {
    outputArray.push(`❌ Ошибка SSH-соединения: ${err.message}`);
    console.error('Ошибка SSH-соединения:', err);
    res.status(500).json({ message: 'Не удалось подключиться к серверу.', error: err.message, logs: outputArray });
  }).connect({
    host,
    port: 22,
    username,
    password
  });
});

app.listen(port, () => {
  console.log(`✅ Сервер запущен на http://localhost:${port}`);
});
