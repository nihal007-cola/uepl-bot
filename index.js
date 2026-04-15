require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('http');

// CONFIG
const PASSWORD = "1234";
const PORT = process.env.PORT || 3000;

// BOT INIT
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
bot.deleteWebHook({ drop_pending_updates: true });

// MEMORY
const users = {};

// HELPERS
function isItemCode(text) {
    return /^UEPL-\d+/.test(text);
}

// BOT LOGIC
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!users[chatId]) users[chatId] = { auth: false };

    if (!users[chatId].auth) {
        if (text === PASSWORD) {
            users[chatId].auth = true;
            return bot.sendMessage(chatId, "Access granted. Send image or item code.");
        } else {
            return bot.sendMessage(chatId, "Welcome. I am Bot Nihal, junior merchant at UEPL.\nPassword please.");
        }
    }

    if (msg.photo) {
        try {
            await bot.sendMessage(chatId, "Processing image...");

            const photo = msg.photo[msg.photo.length - 1];
            const file = await bot.getFile(photo.file_id);

            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
            const fileName = `image_${Date.now()}.jpg`;
            const filePath = path.join(__dirname, fileName);

            const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            writer.on('finish', async () => {
                await bot.sendMessage(chatId, "Image downloaded ✅");
                await bot.sendMessage(chatId, "Next: QR detection");
            });

            writer.on('error', async () => {
                await bot.sendMessage(chatId, "Error downloading image ❌");
            });

        } catch (err) {
            console.log(err);
            await bot.sendMessage(chatId, "Failed ❌");
        }
        return;
    }

    if (text && isItemCode(text)) {
        return bot.sendMessage(chatId, `Fetching ${text} (next step)`);
    }

    return bot.sendMessage(chatId, "Send image or item code.");
});

// HTTP SERVER
const server = http.createServer((req, res) => {

    // favicon
    if (req.url === "/favicon.ico") {
        const filePath = path.join(__dirname, "favicon.ico");
        return fs.createReadStream(filePath).pipe(res);
    }

    // logo
    if (req.url === "/logo.png") {
        const filePath = path.join(__dirname, "logo.png");
        return fs.createReadStream(filePath).pipe(res);
    }

    // homepage
    if (req.url === "/") {
        const filePath = path.join(__dirname, "index.html");
        return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
