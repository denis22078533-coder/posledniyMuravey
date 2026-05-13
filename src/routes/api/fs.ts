import fs from "node:fs/promises";
import path from "node:path";

// Абсолютный путь к корню проекта
const projectRoot = path.resolve(process.cwd());
const srcRoot = path.resolve(projectRoot, "src");

// ВАЖНО: Этот эндпоинт в текущем виде НЕБЕЗОПАСЕН.
// Проверка прав доступа выполняется на клиенте в src/lib/ai.ts.
// В идеальном мире здесь должна быть проверка сессии или токена.
export const POST = async ({ request }: { request: Request }): Promise<Response> => {

  const { operation, path: relativePath, content } = await request.json();

  if (!relativePath || typeof relativePath !== "string") {
    return new Response("Invalid path", { status: 400 });
  }

  // Валидация пути (защита от выхода за пределы `src`)
  const targetPath = path.resolve(srcRoot, relativePath);

  if (!targetPath.startsWith(srcRoot)) {
    return new Response("Forbidden: Path is outside the allowed directory", { status: 403 });
  }

  try {
    if (operation === "read") {
      const fileContent = await fs.readFile(targetPath, "utf-8");
      return new Response(JSON.stringify({ content: fileContent }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else if (operation === "write") {
      if (typeof content !== "string") {
        return new Response("Invalid content", { status: 400 });
      }
      await fs.writeFile(targetPath, content, "utf-8");
      return new Response("File written successfully", { status: 200 });
    } else {
      return new Response("Invalid operation", { status: 400 });
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return new Response("File not found", { status: 404 });
    }
    console.error("[FS API Error]", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
