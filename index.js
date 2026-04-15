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

// INIT
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.deleteWebHook({ drop_pending_updates: true });

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
        users[chatId] = { auth: false, time: 0 };
    }

    const user = users[chatId];

    // SESSION (safe)
    if (user.auth && !user.step && Date.now() - user.time > SESSION_DURATION) {
        user.auth = false;
    }

    // 🔐 AUTH
    if (!user.auth) {
        if (text === PASSWORD) {
            user.auth = true;
            user.time = Date.now();
            return bot.sendMessage(chatId, "Access granted. Send image or item code.");
        }
        return bot.sendMessage(chatId, "GO AWAY BRUV! this is for UEPL use only.");
    }

    // 🔁 ENTRY FLOW
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
            const finalImage = await brandImage(user.imagePath, itemCode);

            await bot.sendPhoto(chatId, finalImage, {
                caption: `Item saved ✅\nCode: ${itemCode}`
            });

            return;
        }
    }

    // 🔎 ITEM CODE → ENQUIRY
    if (text && isItemCode(text)) {
        user.verify = true;
        user.pendingCode = text;
        return bot.sendMessage(chatId, "Enter password for verification.");
    }

    // 📸 IMAGE
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

            // ❌ NO QR → ENTRY
            if (!qr) {
                user.step = "name";
                user.imagePath = filePath;
                return bot.sendMessage(chatId, "Item Name?");
            }

            // ✅ QR → ENQUIRY
            user.verify = true;
            return bot.sendMessage(chatId, "Verification required. Enter password.");
        });

        return;
    }

    return bot.sendMessage(chatId, "Send image or item code.");
});

// SERVER
const server = http.createServer((req, res) => {

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
