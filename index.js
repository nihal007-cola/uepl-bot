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

// BOT INIT
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.deleteWebHook({ drop_pending_updates: true });

// MEMORY
const users = {};
let ITEM_COUNTER = 1;

// HELPERS
function isItemCode(text) {
    return /^UEPL\d+$/.test(text);
}

// QR GENERATOR
function generateQR(itemCode) {
    const hash = crypto
        .createHash('sha256')
        .update(itemCode + SECRET)
        .digest('hex')
        .slice(0, 8);

    return `${itemCode}|${hash}`;
}

// QR DETECTOR
async function detectQR(filePath) {
    try {
        const img = await loadImage(filePath);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);

        const code = jsQR(imageData.data, img.width, img.height);
        if (!code) return null;

        return code.data;
    } catch (err) {
        console.log(err);
        return null;
    }
}

// BRAND IMAGE
async function brandImage(inputPath, itemCode) {

    const qrText = generateQR(itemCode);
    const qrBuffer = await QRCode.toBuffer(qrText, { width: 160 });

    const brandingSVG = Buffer.from(`
        <svg width="600" height="80">
            <text x="10" y="50"
            font-size="28"
            fill="black"
            font-family="Arial">
            Powered by Offices of Nawnit Nihal
            </text>
        </svg>
    `);

    const base = sharp(inputPath);
    const meta = await base.metadata();

    const padding = 20;
    const bottomStrip = 120;

    const newWidth = meta.width + padding * 2;
    const newHeight = meta.height + padding * 2 + bottomStrip;

    const outputPath = inputPath.replace(".jpg", "_card.jpg");

    const canvas = sharp({
        create: {
            width: newWidth,
            height: newHeight,
            channels: 3,
            background: "#ffffff"
        }
    });

    await canvas
        .composite([
            { input: await base.toBuffer(), top: padding, left: padding },
            { input: qrBuffer, top: newHeight - bottomStrip + 20, left: newWidth - 180 },
            { input: brandingSVG, top: newHeight - bottomStrip + 30, left: 20 }
        ])
        .jpeg()
        .toFile(outputPath);

    return outputPath;
}

// BOT LOGIC
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!users[chatId]) users[chatId] = { auth: false };

    // AUTH
    if (!users[chatId].auth) {
        if (text === PASSWORD) {
            users[chatId].auth = true;
            return bot.sendMessage(chatId, "Access granted. Send image or item code.");
        }
        return bot.sendMessage(chatId, "Welcome. I am Bot Nihal, junior merchant at UEPL.\nPassword please.");
    }

    // ITEM CODE → ENQUIRY
    if (text && isItemCode(text)) {
        users[chatId].pendingCode = text;
        users[chatId].verify = true;
        return bot.sendMessage(chatId, "Verification required. Enter password.");
    }

    // IMAGE FLOW
    if (msg.photo) {
        try {
            await bot.sendMessage(chatId, "Processing image...");

            const photo = msg.photo[msg.photo.length - 1];
            const file = await bot.getFile(photo.file_id);

            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
            const fileName = `image_${Date.now()}.jpg`;
            const filePath = path.join(__dirname, fileName);

            const response = await axios({
                url: fileUrl,
                method: 'GET',
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            writer.on('finish', async () => {

                const qrData = await detectQR(filePath);

                // NO QR → ENTRY
                if (!qrData) {

                    const itemCode = `UEPL${ITEM_COUNTER++}`;
                    const finalImage = await brandImage(filePath, itemCode);

                    await bot.sendPhoto(chatId, finalImage, {
                        caption: `Item saved ✅\nCode: ${itemCode}`
                    });

                    users[chatId].step = "item_name";

                    return bot.sendMessage(chatId, "Item Name?");
                }

                // QR FOUND → VALIDATE
                const [code, hash] = qrData.split("|");

                const expected = crypto
                    .createHash('sha256')
                    .update(code + SECRET)
                    .digest('hex')
                    .slice(0, 8);

                if (hash !== expected) {
                    return bot.sendMessage(chatId, "Invalid QR ❌ Treated as new entry.");
                }

                // VALID QR → ENQUIRY
                users[chatId].verify = true;
                users[chatId].pendingCode = code;

                return bot.sendMessage(chatId, "Verification required. Enter password.");
            });

        } catch (err) {
            console.log(err);
            await bot.sendMessage(chatId, "Processing failed ❌");
        }
        return;
    }

    return bot.sendMessage(chatId, "Send image or item code.");
});

// HTTP SERVER
const server = http.createServer((req, res) => {

    if (req.url === "/favicon.ico") {
        return fs.createReadStream(path.join(__dirname, "favicon.ico")).pipe(res);
    }

    if (req.url === "/logo.png") {
        return fs.createReadStream(path.join(__dirname, "logo.png")).pipe(res);
    }

    if (req.url === "/") {
        return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    }

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
