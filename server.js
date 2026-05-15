const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3001;

// Разрешаем CORS-запросы с любого источника для простоты разработки
app.use(cors());

// Включаем обработку JSON-тел в запросах
app.use(express.json({ limit: '10mb' }));

const projectRoot = process.cwd();

// Обработчик POST-запросов для записи файлов
app.post('/api/fs', (req, res) => {
  const { path: relativePath, content } = req.body;

  if (!relativePath || typeof relativePath !== 'string' || content === undefined) {
    return res.status(400).send({ message: 'Некорректный запрос: требуются путь и контент файла.' });
  }

  const targetPath = path.resolve(projectRoot, relativePath);

  // Важная проверка безопасности: убеждаемся, что путь не выходит за пределы корня проекта
  if (!targetPath.startsWith(projectRoot)) {
    return res.status(403).send({ message: 'Запрещено: путь выходит за пределы разрешенной директории.' });
  }

  try {
    const dir = path.dirname(targetPath);
    // Создаем директорию, если она не существует
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Записываем контент в файл
    fs.writeFileSync(targetPath, content, 'utf8');
    
    console.log(`[OK] Файл записан: ${relativePath}`);
    res.status(200).send({ message: `Файл ${relativePath} успешно сохранен.` });
  } catch (error) {
    console.error(`[ОШИБКА] Не удалось записать файл: ${relativePath}`, error);
    res.status(500).send({ message: 'Ошибка при записи файла.', error: error.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Сервер запущен на http://localhost:${port}`);
  console.log('Готов принимать запросы на запись файлов по маршруту /api/fs');
});
