require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const users = {};
const PASSWORD = "1234";

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!users[chatId]) {
        users[chatId] = { auth: false };
    }

    if (!users[chatId].auth) {
        if (text === PASSWORD) {
            users[chatId].auth = true;
            return bot.sendMessage(chatId, "Access granted. Send image or item code.");
        } else {
            return bot.sendMessage(chatId, "Welcome. I am Bot Nihal, junior merchant at UEPL.\nPassword please.");
        }
    }

    if (msg.photo) {
        return bot.sendMessage(chatId, "Image received (next step: QR check).");
    }

    if (text && text.startsWith("UEPL-")) {
        return bot.sendMessage(chatId, "Fetching item details (next step).");
    }

    return bot.sendMessage(chatId, "Send image or item code.");
});
