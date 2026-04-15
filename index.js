require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('http');

const QRCode = require('qrcode');
const sharp = require('sharp');
const crypto = require('crypto');

// CONFIG
const PASSWORD = "1234";
const PORT = process.env.PORT || 3000;
const SECRET = "UEPL_SECRET_2026";

// BOT INIT
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.deleteWebHook({ drop_pending_updates: true });

// MEMORY
const users = {};

// HELPERS
function isItemCode(text) {
    return /^UEPL-\d+/.test(text);
}

// 🔐 QR GENERATOR
function generateQR(itemCode) {
    const hash = crypto
        .createHash('sha256')
        .update(itemCode + SECRET)
        .digest('hex')
        .slice(0, 8);

    return `${itemCode}|${hash}`;
}

// 🖼️ BRAND IMAGE
async function brandImage(inputPath, itemCode) {

    const qrText = generateQR(itemCode);

    const qrBuffer = await QRCode.toBuffer(qrText, { width: 180 });

    const outputPath = inputPath.replace(".jpg", "_final.jpg");

    const image = sharp(inputPath);
    const meta = await image.metadata();

    await image
        .composite([
            {
                input: qrBuffer,
                top: meta.height - 200,
                left: meta.width - 200
            }
        ])
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
        } else {
            return bot.sendMessage(chatId, "Welcome. I am Bot Nihal, junior merchant at UEPL.\nPassword please.");
        }
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

                const itemCode = `UEPL-${Date.now()}`;

                const finalImage = await brandImage(filePath, itemCode);

                await bot.sendPhoto(chatId, finalImage, {
                    caption: `Item saved ✅\nCode: ${itemCode}`
                });

            });

            writer.on('error', async () => {
                await bot.sendMessage(chatId, "Download error ❌");
            });

        } catch (err) {
            console.log(err);
            await bot.sendMessage(chatId, "Processing failed ❌");
        }
        return;
    }

    // ITEM CODE
    if (text && isItemCode(text)) {
        return bot.sendMessage(chatId, `Searching ${text} (next step)`);
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
