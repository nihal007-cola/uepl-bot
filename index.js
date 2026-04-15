require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('http');

const QRCode = require('qrcode');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { createCanvas, loadImage } = require('canvas');
const Tesseract = require('tesseract.js');

// CONFIG
const PASSWORD = "1234";
const PORT = process.env.PORT || 3000;
const SESSION_DURATION = 30 * 60 * 1000;
const SHEET_URL = "https://script.google.com/macros/s/AKfycbyLZYpvG43iBedT0iJzjZE0gFFbXviQR61KCTzIg4Sp9norCVZQPZH2wUISK5d_dWtL/exec";

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: { autoStart: false }
});

(async () => {
  await bot.deleteWebHook({ drop_pending_updates: true });
  await bot.startPolling();
})();

const users = {};
let ITEM_COUNTER = 1;

// HELPERS
function isItemCode(text) {
  return /^UEPL\d+$/.test(text);
}

function generateQR(itemCode) {
  return itemCode;
}

// 🔥 OCR STRONG (STICKER ONLY)
async function extractText(imagePath) {

  const cleanPath = imagePath.replace(".jpg", "_clean.jpg");

  await sharp(imagePath)
    .grayscale()
    .normalize()
    .sharpen()
    .threshold(140)
    .toFile(cleanPath);

  const { data: { text } } = await Tesseract.recognize(cleanPath, 'eng');

  return text;
}

// 🔥 PARSER (IMPROVED)
function parseText(text) {

  text = text.toUpperCase();

  return {
    name: (text.match(/ITEM\s*NO\.?\s*[:\-]?\s*([A-Z0-9]+)/)||[])[1],
    gsm: (text.match(/(\d{2,4})\s*GSM/)||[])[1],
    supplier: (text.match(/([A-Z]+)\s*TEXTILE/)||[])[1],
    count: (text.match(/(\d+\s*WALES.*?)\n/)||[])[1],
    width: (text.match(/(\d{2,4}\s*CM)/)||[])[1]
  };
}

// QR READ
async function detectQR(filePath) {
  const img = await loadImage(filePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);

  const code = jsQR(data.data, img.width, img.height);
  return code ? code.data : null;
}

// BRAND IMAGE
async function brandImage(inputPath, itemCode) {

  const qrBuffer = await QRCode.toBuffer(generateQR(itemCode), { width: 140 });
  const logoPath = path.join(__dirname, "logo.png");

  const base = sharp(inputPath);
  const meta = await base.metadata();

  const padding = 20;
  const strip = 120;
  const output = inputPath.replace(".jpg", "_final.jpg");

  const canvas = sharp({
    create: {
      width: meta.width + padding * 2,
      height: meta.height + padding * 2 + strip,
      channels: 3,
      background: "#ffffff"
    }
  });

  await canvas.composite([
    { input: await base.toBuffer(), top: padding, left: padding },
    { input: qrBuffer, top: meta.height + padding + 20, left: meta.width - 150 },
    { input: logoPath, top: meta.height + padding + 30, left: 20 }
  ])
  .jpeg()
  .toFile(output);

  return output;
}

// BOT LOGIC
bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  if (!users[chatId]) {
    users[chatId] = { auth: false, time: 0 };
  }

  const user = users[chatId];

  // SESSION
  if (user.auth && Date.now() - user.time > SESSION_DURATION) {
    user.auth = false;
  }

  // AUTH
  if (!user.auth) {
    if (text === PASSWORD) {
      user.auth = true;
      user.time = Date.now();
      return bot.sendMessage(chatId, "Send fabric image.");
    }
    return bot.sendMessage(chatId, "GO AWAY BRUV!");
  }

  // ITEM CODE ENQUIRY
  if (text && isItemCode(text)) {
    const res = await axios.get(`${SHEET_URL}?code=${text}`);
    if (res.data === "NOT_FOUND") {
      return bot.sendMessage(chatId, "Item not found ❌");
    }

    const d = res.data;

    await bot.sendPhoto(chatId, d.image);

    return bot.sendMessage(chatId,
`Item Details 📦

Item Name: ${d.name}
GSM: ${d.gsm}
Supplier: ${d.supplier}
Code: ${d.code}`);
  }

  // IMAGE FLOW
  if (msg.photo) {

    const photo = msg.photo[msg.photo.length - 1];
    const file = await bot.getFile(photo.file_id);

    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const filePath = path.join(__dirname, `img_${Date.now()}.jpg`);

    const res = await axios({ url, method: 'GET', responseType: 'stream' });
    const writer = fs.createWriteStream(filePath);
    res.data.pipe(writer);

    writer.on('finish', async () => {

      // 🔥 FIRST IMAGE = FABRIC
      if (!user.fabricImage) {
        user.fabricImage = filePath;
        return bot.sendMessage(chatId, "Now send sticker image.");
      }

      // 🔥 SECOND IMAGE = STICKER (OCR HERE)
      const rawText = await extractText(filePath);
      const parsed = parseText(rawText);

      const itemCode = `UEPL${ITEM_COUNTER++}`;
      const finalImage = await brandImage(user.fabricImage, itemCode);

      const imageUrl = `https://uepl-bot.onrender.com/${path.basename(finalImage)}`;

      await axios.post(SHEET_URL, {
        code: itemCode,
        name: parsed.name || "UNKNOWN",
        gsm: parsed.gsm || "UNKNOWN",
        supplier: parsed.supplier || "UNKNOWN",
        count: parsed.count || "",
        stock: parsed.width || "",
        image: imageUrl
      });

      user.fabricImage = null;

      await bot.sendPhoto(chatId, finalImage, {
        caption: `Saved via OCR ✅\nCode: ${itemCode}`
      });

    });

    return;
  }

  return bot.sendMessage(chatId, "Send fabric image.");
});

// SERVER unchanged
const server = http.createServer(async (req, res) => {

  if (req.url.startsWith("/img_") || req.url.includes("_final.jpg")) {
    const filePath = path.join(__dirname, req.url);
    if (fs.existsSync(filePath)) {
      return fs.createReadStream(filePath).pipe(res);
    }
  }

  if (req.url === "/api/items") {
    const response = await axios.get(SHEET_URL + "?code=ALL");
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(response.data));
  }

  if (req.url === "/") {
    return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  }

  if (req.url === "/favicon.ico") {
    return fs.createReadStream(path.join(__dirname, "favicon.ico")).pipe(res);
  }

  if (req.url === "/logo.png") {
    return fs.createReadStream(path.join(__dirname, "logo.png")).pipe(res);
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT);
