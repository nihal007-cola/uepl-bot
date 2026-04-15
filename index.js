require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ===== CONFIG =====
const PASSWORD = "1234";

// ===== MEMORY STORE (MVP) =====
const users = {};

// ===== HELPER =====
function isItemCode(text) {
    return /^UEPL-\d+/.test(text);
}

// ===== MAIN HANDLER =====
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!users[chatId]) {
        users[chatId] = { auth: false };
    }

    // ===== AUTH FLOW =====
    if (!users[chatId].auth) {
        if (text === PASSWORD) {
            users[chatId].auth = true;
            return bot.sendMessage(chatId, "Access granted. Send image or item code.");
        } else {
            return bot.sendMessage(
                chatId,
                "Welcome. I am UEPL BOT, module of ONNwork.\nPassword please."
            );
        }
    }

    // ===== IMAGE HANDLING =====
    if (msg.photo) {
        try {
            await bot.sendMessage(chatId, "Processing image...");

            // Get highest quality image
            const photo = msg.photo[msg.photo.length - 1];
            const fileId = photo.file_id;

            // Get file path
            const file = await bot.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

            // Create filename
            const fileName = `image_${Date.now()}.jpg`;
            const filePath = path.join(__dirname, fileName);

            // Download image
            const response = await axios({
                url: fileUrl,
                method: 'GET',
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            writer.on('finish', async () => {
                await bot.sendMessage(chatId, "Image downloaded ✅");

                // 👉 NEXT STEP PLACEHOLDER (QR DETECTION)
                await bot.sendMessage(chatId, "Next: QR detection (coming in next step)");
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

    // ===== ITEM CODE SEARCH =====
    if (text && isItemCode(text)) {
        return bot.sendMessage(chatId, `Fetching details for ${text} (next step).`);
    }

    // ===== DEFAULT =====
    return bot.sendMessage(chatId, "Send image or item code.");
});
