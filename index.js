require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('http');

const QRCode = require('qrcode');
const sharp = require('sharp');
const crypto = require('crypto');
const jsQR = require('jsqr');
const { createCanvas, loadImage } = require('canvas');

// CONFIG
const PASSWORD = "1234";
const PORT = process.env.PORT || 3000;
const SECRET = "UEPL_SECRET_2026";
const SESSION_DURATION = 30 * 60 * 1000;
const SHEET_URL = "https://script.google.com/macros/s/AKfycbyLZYpvG43iBedT0iJzjZE0gFFbXviQR61KCTzIg4Sp9norCVZQPZH2wUISK5d_dWtL/exec";

// 🔥 SAFE BOT INIT (FIXED)
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: { autoStart: false }
});

// 🔥 CLEAN START (NO CONFLICT)
(async () => {
  try {
    await bot.deleteWebHook({ drop_pending_updates: true });
    await bot.startPolling();
    console.log("✅ Bot started safely");
  } catch (err) {
    console.log("Polling error handled:", err.message);
  }
})();

const users = {};
let ITEM_COUNTER = 1;

// HELPERS
function isItemCode(text) {
    return /^UEPL\d+$/.test(text);
}

function generateQR(itemCode) {
    const hash = crypto
        .createHash('sha256')
        .update(itemCode + SECRET)
        .digest('hex')
        .slice(0, 8);

    return `${itemCode}|${hash}`;
}

async function detectQR(filePath) {
    try {
        const img = await loadImage(filePath);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');

        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);

        const code = jsQR(data.data, img.width, img.height);
        return code ? code.data : null;
    } catch {
        return null;
    }
}

// BRAND IMAGE
async function brandImage(inputPath, itemCode) {

    const qrBuffer = await QRCode.toBuffer(generateQR(itemCode), { width: 140 });

    const brandingSVG = Buffer.from(`
        <svg width="600" height="80">
            <text x="10" y="50" font-size="26" fill="black">
            Powered by Offices of Nawnit Nihal
            </text>
        </svg>
    `);

    const base = sharp(inputPath);
    const meta = await base.metadata();

    const padding = 20;
    const strip = 120;

    const output = inputPath.replace(".jpg", "_card.jpg");

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
        { input: qrBuffer, top: meta.height + padding + 20, left: meta.width - 160 },
        { input: brandingSVG, top: meta.height + padding + 30, left: 20 }
    ])
    .jpeg()
    .toFile(output);

    return output;
}

// BOT
bot.on('message', async (msg) => {

    const chatId = msg.chat.id;
    const text = msg.text;

    if (!users[chatId]) {
        users[chatId] = { auth: false, time: 0, verify: false };
    }

    const user = users[chatId];

    // SESSION
    if (user.auth && !user.step && Date.now() - user.time > SESSION_DURATION) {
        user.auth = false;
    }

    // AUTH + VERIFY
    if (!user.auth || user.verify) {

        if (text === PASSWORD) {

            user.auth = true;
            user.time = Date.now();

            if (user.verify) {
                user.verify = false;

                const res = await axios.get(`${SHEET_URL}?code=${user.pendingCode}`);

                if (res.data === "NOT_FOUND") {
                    return bot.sendMessage(chatId, "Item not found ❌");
                }

                const d = res.data;

                return bot.sendMessage(chatId,
`Item Details 📦

Item Name: ${d.name}
Count: ${d.count}
GSM: ${d.gsm}
Supplier: ${d.supplier}
Rate: ${d.rate}
Availability: ${d.stock}
Code: ${d.code}`);
            }

            return bot.sendMessage(chatId, "Access granted. Send image or item code.");
        }

        return bot.sendMessage(chatId, "GO AWAY BRUV! this is for UEPL use only.");
    }

    // ENTRY FLOW
    if (user.step) {

        user.time = Date.now();

        if (user.step === "name") {
            user.name = text;
            user.step = "count";
            return bot.sendMessage(chatId, "Count & Construction?");
        }

        if (user.step === "count") {
            user.count = text;
            user.step = "gsm";
            return bot.sendMessage(chatId, "GSM?");
        }

        if (user.step === "gsm") {
            user.gsm = text;
            user.step = "supplier";
            return bot.sendMessage(chatId, "Supplier?");
        }

        if (user.step === "supplier") {
            user.supplier = text;
            user.step = "rate";
            return bot.sendMessage(chatId, "Rate?");
        }

        if (user.step === "rate") {
            user.rate = text;
            user.step = "stock";
            return bot.sendMessage(chatId, "Availability / meter?");
        }

        if (user.step === "stock") {

            user.stock = text;
            user.step = null;

            const itemCode = `UEPL${ITEM_COUNTER++}`;

            await axios.post(SHEET_URL, {
                code: itemCode,
                name: user.name,
                count: user.count,
                gsm: user.gsm,
                supplier: user.supplier,
                rate: user.rate,
                stock: user.stock,
                image: user.imagePath
            });

            const finalImage = await brandImage(user.imagePath, itemCode);

            await bot.sendPhoto(chatId, finalImage, {
                caption: `Item saved ✅\nCode: ${itemCode}`
            });

            return;
        }
    }

    // ITEM CODE
    if (text && isItemCode(text)) {
        user.verify = true;
        user.pendingCode = text;
        return bot.sendMessage(chatId, "Verification required. Enter password.");
    }

    // IMAGE
    if (msg.photo) {

        const photo = msg.photo[msg.photo.length - 1];
        const file = await bot.getFile(photo.file_id);

        const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        const filePath = path.join(__dirname, `img_${Date.now()}.jpg`);

        const res = await axios({ url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(filePath);
        res.data.pipe(writer);

        writer.on('finish', async () => {

            const qr = await detectQR(filePath);

            if (!qr) {
                user.step = "name";
                user.imagePath = filePath;
                return bot.sendMessage(chatId, "Item Name?");
            }

            user.verify = true;
            user.pendingCode = qr.split("|")[0];

            return bot.sendMessage(chatId, "Verification required. Enter password.");
        });

        return;
    }

    return bot.sendMessage(chatId, "Send image or item code.");
});

// SAAS API
const server = http.createServer(async (req, res) => {

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

server.listen(PORT, () => {
  console.log("🌐 Server running on port", PORT);
});
