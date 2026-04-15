require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const API = "https://script.google.com/macros/s/AKfycbyLZYpvG43iBedT0iJzjZE0gFFbXviQR61KCTzIg4Sp9norCVZQPZH2wUISK5d_dWtL/exec";

// START
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "📦 Send Item Code (e.g. UEPL123)");
});

// MAIN
bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  try {

    // 🔥 fetch item
    const res = await axios.get(`${API}?action=get&item=${encodeURIComponent(text.trim())}`);

    const data = res.data;

    if (!data || data.length === 0) {
      return bot.sendMessage(chatId, "❌ Item not found");
    }

    const d = data[0];

    // 🎯 clean forward-ready caption
    const caption = 
`📦 ${d.item || ""}

Count: ${d.count || ""}
Construction: ${d.construction || ""}
Composition: ${d.composition || ""}
Weight: ${d.weight || ""}
Width: ${d.width || ""}
Availability: ${d.availability || ""}`;

    // 🔥 send FINAL image (already branded + QR)
    if (d.image) {
      await bot.sendPhoto(chatId, d.image, {
        caption: caption,
        parse_mode: "Markdown"
      });
    } else {
      bot.sendMessage(chatId, caption);
    }

  } catch (err) {
    console.log(err);
    bot.sendMessage(chatId, "⚠️ Error fetching item");
  }

});
