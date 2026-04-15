require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');
const QRCode = require('qrcode');
const sharp = require('sharp');

// CONFIG
const PASSWORD = "1234";
const PORT = process.env.PORT || 3000;
const SHEET_URL = "https://script.google.com/macros/s/AKfycbyLZYpvG43iBedT0iJzjZE0gFFbXviQR61KCTzIg4Sp9norCVZQPZH2wUISK5d_dWtL/exec";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();
app.use(express.static(__dirname));

const users = {};
let ITEM_COUNTER = 1;

// DEFAULT FORM VALUES
const DEFAULTS = {
  name: "Cotton",
  count: "60x60",
  gsm: "120",
  supplier: "Arvind",
  rate: "",
  availability: ""
};

// ---------- FORM UI ----------
function renderForm(chatId, user, messageId = null) {
  const f = user.form;

  const text = `
📦 *New Item Entry*

*Name:* ${f.name}
*Count:* ${f.count}
*GSM:* ${f.gsm}
*Supplier:* ${f.supplier}
*Rate:* ${f.rate || "-"}
*Availability:* ${f.availability || "-"}

✏️ Edit fields or Submit
`;

  const opts = {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Edit Name", callback_data: "edit_name" }],
        [{ text: "Edit Count", callback_data: "edit_count" }],
        [{ text: "Edit GSM", callback_data: "edit_gsm" }],
        [{ text: "Edit Supplier", callback_data: "edit_supplier" }],
        [{ text: "Edit Rate", callback_data: "edit_rate" }],
        [{ text: "Edit Availability", callback_data: "edit_availability" }],
        [{ text: "✅ Submit", callback_data: "submit" }],
        [{ text: "❌ Cancel", callback_data: "cancel" }]
      ]
    }
  };

  if (messageId) {
    bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
  } else {
    bot.sendMessage(chatId, text, opts);
  }
}

// ---------- BRAND IMAGE ----------
async function brandImage(inputPath, itemCode) {
  const qrBuffer = await QRCode.toBuffer(itemCode, { width: 150 });
  const meta = await sharp(inputPath).metadata();

  const output = inputPath.replace(".jpg", "_final.jpg");

  await sharp({
    create: {
      width: meta.width,
      height: meta.height + 150,
      channels: 3,
      background: "#ffffff"
    }
  })
    .composite([
      { input: inputPath, top: 0, left: 0 },
      { input: qrBuffer, top: meta.height + 10, left: meta.width - 160 }
    ])
    .toFile(output);

  return output;
}

// ---------- AUTH ----------
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!users[chatId]) users[chatId] = { auth: false };

  const user = users[chatId];

  if (!user.auth) {
    if (text === PASSWORD) {
      user.auth = true;
      return bot.sendMessage(chatId, "✅ Authenticated! Send fabric image.");
    }
    if (text) return bot.sendMessage(chatId, "🔒 Send password (1234)");
    return;
  }

  // IMAGE RECEIVED
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    const file = await bot.getFile(photo.file_id);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const filePath = path.join(__dirname, `img_${Date.now()}.jpg`);

    const response = await axios({ url, method: 'GET', responseType: 'arraybuffer' });
    fs.writeFileSync(filePath, response.data);

    user.image = filePath;
    user.form = { ...DEFAULTS };
    user.state = "FORM";

    return renderForm(chatId, user);
  }

  // TEXT INPUT FOR EDIT
  if (user.state === "EDITING") {
    user.form[user.editField] = text;
    user.state = "FORM";
    return renderForm(chatId, user, user.formMessageId);
  }
});

// ---------- BUTTON HANDLER ----------
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const action = query.data;

  const user = users[chatId];

  if (!user) return;

  // EDIT
  if (action.startsWith("edit_")) {
    const field = action.replace("edit_", "");
    user.state = "EDITING";
    user.editField = field;
    user.formMessageId = msgId;

    return bot.sendMessage(chatId, `Enter ${field}:`);
  }

  // CANCEL
  if (action === "cancel") {
    user.state = null;
    return bot.sendMessage(chatId, "❌ Cancelled");
  }

  // SUBMIT
  if (action === "submit") {
    const itemCode = `UEPL${ITEM_COUNTER++}`;

    const finalImage = await brandImage(user.image, itemCode);

    const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const imageUrl = `${baseUrl}/${path.basename(finalImage)}`;

    await axios.post(SHEET_URL, {
      code: itemCode,
      name: user.form.name,
      gsm: user.form.gsm,
      supplier: user.form.supplier,
      count: user.form.count,
      rate: user.form.rate,
      stock: user.form.availability,
      image: imageUrl
    });

    await bot.sendPhoto(chatId, finalImage, {
      caption: `✅ Saved\n\nCode: ${itemCode}`
    });

    user.state = null;
    user.image = null;
  }
});

// ---------- SERVER ----------
app.get('/', (req, res) => res.send("Bot Running"));

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
