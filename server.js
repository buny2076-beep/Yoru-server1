import express from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOT_INDEX = path.join(__dirname, "index.html");
const GENERATED_DIR = path.join(PUBLIC_DIR, "generated");
const MAX_PROMPT_LENGTH = 8000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/generated", express.static(GENERATED_DIR, { maxAge: "1h" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "YORU AI Master", imageConfigured: Boolean(process.env.OPENAI_API_KEY), videoConfigured: Boolean(process.env.VIDEO_PROVIDER_URL && process.env.VIDEO_PROVIDER_API_KEY) });
});

function sizeForRatio(ratio) {
  if (ratio === "portrait") return "1024x1536";
  if (ratio === "landscape") return "1536x1024";
  return "1024x1024";
}

function addStyle(prompt, style) {
  const styles = {
    neon: "Visual style: vivid neon cyberpunk, luminous edges, dramatic contrast, rich magenta and cyan glow.",
    fantasy: "Visual style: cinematic fantasy illustration, magical atmosphere, detailed worldbuilding, volumetric light.",
    space: "Visual style: cosmic science-fiction art, deep space, luminous nebulae, dramatic scale and fine detail.",
    anime: "Visual style: polished anime illustration, expressive composition, carefully designed lighting and colors.",
    dark: "Visual style: dark aesthetic, moody cinematic lighting, deep shadows, elegant highlights, atmospheric detail.",
    realistic: "Visual style: photorealistic image, natural materials, physically plausible lighting, high detail."
  };
  const suffix = styles[style] || "";
  return suffix ? `${prompt}\n\n${suffix}` : prompt;
}

app.post("/api/ai-master/generate", async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    const type = req.body?.type === "video" ? "video" : "image";
    const style = typeof req.body?.style === "string" ? req.body.style : "";
    const ratio = typeof req.body?.ratio === "string" ? req.body.ratio : "square";

    if (!prompt) return res.status(400).json({ error: "Напиши запрос для генерации." });
    if (prompt.length > MAX_PROMPT_LENGTH) return res.status(400).json({ error: `Запрос слишком длинный: максимум ${MAX_PROMPT_LENGTH} символов.` });

    if (type === "video") {
      // OpenAI's previous Videos API was retired on 2026-09-24.
      // Do not pretend video generation works until a current provider is configured.
      if (!process.env.VIDEO_PROVIDER_URL || !process.env.VIDEO_PROVIDER_API_KEY) {
        return res.status(501).json({
          error: "Генерация изображений подключена. Для видео нужен отдельный видеопровайдер: прежний OpenAI Videos API закрыт 24 сентября 2026 года. Добавь совместимый VIDEO_PROVIDER_URL и VIDEO_PROVIDER_API_KEY после выбора провайдера."
        });
      }
      return res.status(501).json({
        error: "Данные видеопровайдера заданы, но универсальный формат API не поддерживается автоматически. Нужен адаптер под выбранный сервис."
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "На сервере не задан OPENAI_API_KEY. Добавь его в переменные окружения сервиса." });
    }

    const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
    const apiResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        prompt: addStyle(prompt, style),
        size: sizeForRatio(ratio),
        quality: process.env.OPENAI_IMAGE_QUALITY || "high",
        output_format: "png"
      })
    });

    const payload = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      const message = payload?.error?.message || `AI provider returned HTTP ${apiResponse.status}`;
      return res.status(apiResponse.status === 429 ? 429 : 502).json({ error: message });
    }

    const b64 = payload?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: "Провайдер не вернул изображение." });

    await fs.mkdir(GENERATED_DIR, { recursive: true });
    const filename = `yoru-${Date.now()}-${crypto.randomBytes(5).toString("hex")}.png`;
    await fs.writeFile(path.join(GENERATED_DIR, filename), Buffer.from(b64, "base64"));
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json({
      url: `${origin}/generated/${filename}`,
      type: "image",
      title: prompt.slice(0, 100),
      model
    });
  } catch (error) {
    console.error("YORU generation error:", error);
    res.status(500).json({ error: "Внутренняя ошибка сервера. Проверь логи сервера." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(ROOT_INDEX, (err) => {
    if (err && !res.headersSent) {
      res.status(404).send("YORU index.html not found");
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`YORU AI Master server listening on port ${PORT}`);
});
