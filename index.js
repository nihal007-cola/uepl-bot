require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('http');

// ===== CONFIG =====
const PASSWORD = "1234";
const PORT = process.env.PORT || 3000;

// ===== INIT BOT =====
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ===== MEMORY STORE =====
const users = {};

// ===== HELPER =====
function isItemCode(text) {
    return /^UEPL-\d+/.test(text);
}

// ===== TELEGRAM LOGIC =====
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!users[chatId]) {
        users[chatId] = { auth: false };
    }

    // ===== AUTH =====
    if (!users[chatId].auth) {
        if (text === PASSWORD) {
            users[chatId].auth = true;
            return bot.sendMessage(chatId, "Access granted. Send image or item code.");
        } else {
            return bot.sendMessage(
                chatId,
                "Welcome. I am Bot Nihal, junior merchant at UEPL.\nPassword please."
            );
        }
    }

    // ===== IMAGE HANDLING =====
    if (msg.photo) {
        try {
            await bot.sendMessage(chatId, "Processing image...");

            const photo = msg.photo[msg.photo.length - 1];
            const fileId = photo.file_id;

            const file = await bot.getFile(fileId);
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
                await bot.sendMessage(chatId, "Image downloaded ✅");
                await bot.sendMessage(chatId, "Next: QR detection (coming next)");
            });

            writer.on('error', async () => {
                await bot.sendMessage(chatId, "Error downloading image ❌");
            });

        } catch (err) {
            console.error(err);
            await bot.sendMessage(chatId, "Failed to process image ❌");
        }

        return;
    }

    // ===== ITEM CODE =====
    if (text && isItemCode(text)) {
        return bot.sendMessage(chatId, `Fetching details for ${text} (next step).`);
    }

    return bot.sendMessage(chatId, "Send image or item code.");
});


// ===== HTTP SERVER (RENDER + UI) =====
const server = http.createServer((req, res) => {

    // Serve homepage
    if (req.url === "/") {
        const filePath = path.join(__dirname, "index.html");

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end("Error loading page");
            } else {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(data);
            }
        });

        return;
    }

    // Fallback
    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
