require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');

const QRCode = require('qrcode');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { createCanvas, loadImage } = require('canvas');
const Tesseract = require('tesseract.js');

// CONFIG
const PASSWORD = "1234";
const PORT = process.env.PORT || 3000;
const SESSION_DURATION = 30 * 60 * 1000;
const SHEET_URL = "https://script.google.com/macros/s/AKfycbyLZYpvG43iBedT0iJzjZE0gFFbXviQR61KCTzIg4Sp9norCVZQPZH2wUISK5d_dWtL/exec";

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Check if BOT_TOKEN exists
if (!process.env.BOT_TOKEN) {
  console.error("FATAL: BOT_TOKEN not found in environment variables!");
  process.exit(1);
}

// Initialize bot - use polling for simpler setup
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

console.log("Bot started with polling mode");

// Serve static files
app.get('/api/items', async (req, res) => {
  try {
    const response = await axios.get(SHEET_URL + "?code=ALL");
    res.json(response.data);
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve image files
app.get('/img_*', (req, res) => {
  const filePath = path.join(__dirname, req.path);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Not found');
  }
});

app.get('/logo.png', (req, res) => {
  const filePath = path.join(__dirname, 'logo.png');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Not found');
  }
});

app.get('/favicon.ico', (req, res) => {
  const filePath = path.join(__dirname, 'favicon.ico');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Not found');
  }
});

app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.send('UEPL Bot is running');
  }
});

const users = {};
let ITEM_COUNTER = 1;

// Load last counter from file if exists
try {
  if (fs.existsSync('counter.txt')) {
    ITEM_COUNTER = parseInt(fs.readFileSync('counter.txt', 'utf8')) || 1;
  }
} catch(e) { console.error('Counter load error:', e); }

function saveCounter() {
  fs.writeFileSync('counter.txt', ITEM_COUNTER.toString());
}

// HELPERS
function isItemCode(text) {
  return /^UEPL\d+$/.test(text);
}

function generateQR(itemCode) {
  return itemCode;
}

// IMPROVED OCR
async function extractText(imagePath) {
  const strategies = [
    async () => {
      const processed = imagePath.replace(".jpg", "_v1.jpg");
      await sharp(imagePath)
        .grayscale()
        .linear(1.5, -50)
        .sharpen()
        .toFile(processed);
      const { data: { text } } = await Tesseract.recognize(processed, 'eng', {
        tessedit_pageseg_mode: '6',
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:., '
      });
      if (fs.existsSync(processed)) fs.unlinkSync(processed);
      return text;
    },
    async () => {
      const processed = imagePath.replace(".jpg", "_v2.jpg");
      await sharp(imagePath)
        .grayscale()
        .threshold(128)
        .toFile(processed);
      const { data: { text } } = await Tesseract.recognize(processed, 'eng');
      if (fs.existsSync(processed)) fs.unlinkSync(processed);
      return text;
    },
    async () => {
      const processed = imagePath.replace(".jpg", "_v3.jpg");
      await sharp(imagePath)
        .normalize()
        .modulate({ brightness: 1.2, contrast: 1.3 })
        .toFile(processed);
      const { data: { text } } = await Tesseract.recognize(processed, 'eng');
      if (fs.existsSync(processed)) fs.unlinkSync(processed);
      return text;
    }
  ];

  let bestText = '';
  for (const strategy of strategies) {
    try {
      const text = await strategy();
      if (text.length > bestText.length) {
        bestText = text;
      }
    } catch (err) {
      console.error('Strategy failed:', err);
    }
  }

  return bestText;
}

// IMPROVED PARSER
function parseText(text) {
  text = text.toUpperCase();
  text = text.replace(/[^A-Z0-9\s\/\-:]/g, ' ');
  
  return {
    name: (text.match(/ITEM\s*NO\.?\s*[:\-]?\s*([A-Z0-9\-\/]+)/) ||
           text.match(/([A-Z]{2,}[0-9]{2,})/) ||
           [])[1] || "UNKNOWN",
    gsm: (text.match(/(\d{2,4})\s*GSM/) ||
          text.match(/GSM\s*[:\-]?\s*(\d{2,4})/) ||
          [])[1] || "UNKNOWN",
    supplier: (text.match(/([A-Z]+)\s*TEXTILE/) ||
               text.match(/SUPPLIER\s*[:\-]?\s*([A-Z]+)/) ||
               [])[1] || "UNKNOWN",
    count: (text.match(/(\d+(?:\s*[Xx]\s*\d+)?)\s*(?:WALES|ENDS|PICKS)/) ||
            text.match(/COUNT\s*[:\-]?\s*([^\n]+)/) ||
            [])[1]?.trim() || "",
    width: (text.match(/(\d{2,4}\s*CM)/) ||
            text.match(/WIDTH\s*[:\-]?\s*([^\n]+)/) ||
            [])[1]?.trim() || ""
  };
}

// BRAND IMAGE
async function brandImage(inputPath, itemCode) {
  try {
    const qrBuffer = await QRCode.toBuffer(generateQR(itemCode), { width: 150, margin: 1 });
    const logoPath = path.join(__dirname, "logo.png");
    
    const base = sharp(inputPath);
    const meta = await base.metadata();
    
    const padding = 20;
    const stripHeight = 130;
    const newWidth = meta.width + padding * 2;
    const newHeight = meta.height + padding * 2 + stripHeight;
    
    const qrImage = await sharp(qrBuffer).resize(150, 150).toBuffer();
    const logoBuffer = fs.existsSync(logoPath) ? await sharp(logoPath).resize(80, 80).toBuffer() : null;
    
    const output = inputPath.replace(".jpg", "_final.jpg");
    
    const compositeOps = [
      { input: await base.toBuffer(), top: padding, left: padding }
    ];
    
    compositeOps.push({ 
      input: qrImage, 
      top: meta.height + padding + 20, 
      left: newWidth - 170 
    });
    
    if (logoBuffer) {
      compositeOps.push({ 
        input: logoBuffer, 
        top: meta.height + padding + 25, 
        left: padding + 10 
      });
    }
    
    await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 3,
        background: "#ffffff"
      }
    })
    .composite(compositeOps)
    .jpeg({ quality: 90 })
    .toFile(output);
    
    return output;
  } catch (err) {
    console.error('Brand image error:', err);
    return inputPath;
  }
}

// BOT LOGIC - WITH DEBUG LOGGING
bot.on('message', async (msg) => {
  console.log(`Received message from ${msg.chat.id}: ${msg.text || 'photo'}`);
  
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!users[chatId]) {
    users[chatId] = { auth: false, time: 0 };
  }

  const user = users[chatId];

  // SESSION CHECK
  if (user.auth && Date.now() - user.time > SESSION_DURATION) {
    user.auth = false;
    user.fabricImage = null;
    console.log(`Session expired for ${chatId}`);
  }

  // AUTH - Send immediate response
  if (!user.auth) {
    if (text === PASSWORD) {
      user.auth = true;
      user.time = Date.now();
      console.log(`User ${chatId} authenticated`);
      return bot.sendMessage(chatId, "✅ Authenticated! Send fabric image first, then sticker image.");
    }
    // Only respond to text messages for password
    if (text) {
      return bot.sendMessage(chatId, "🔒 Send password to continue. Password is: 1234");
    }
    return;
  }

  // ITEM CODE ENQUIRY
  if (text && isItemCode(text)) {
    console.log(`Looking up item: ${text}`);
    try {
      const res = await axios.get(`${SHEET_URL}?code=${text}`);
      if (res.data === "NOT_FOUND" || res.data.error) {
        return bot.sendMessage(chatId, "❌ Item not found");
      }
      
      const d = res.data;
      
      await bot.sendPhoto(chatId, d.image, {
        caption: `📦 *Item Details*\n\n*Name:* ${d.name}\n*GSM:* ${d.gsm}\n*Supplier:* ${d.supplier}\n*Code:* ${d.code}`,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      console.error('Item lookup error:', err.message);
      bot.sendMessage(chatId, "❌ Error fetching item");
    }
    return;
  }

  // IMAGE FLOW
  if (msg.photo) {
    console.log(`Received photo from ${chatId}`);
    const photo = msg.photo[msg.photo.length - 1];
    
    try {
      const file = await bot.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      const filePath = path.join(__dirname, `img_${Date.now()}.jpg`);
      
      const response = await axios({ url, method: 'GET', responseType: 'stream' });
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      
      writer.on('finish', async () => {
        // FIRST IMAGE = FABRIC
        if (!user.fabricImage) {
          user.fabricImage = filePath;
          console.log(`Fabric image saved for ${chatId}`);
          return bot.sendMessage(chatId, "📸 Fabric image saved. Now send the *sticker image* with text.", { parse_mode: 'Markdown' });
        }
        
        // SECOND IMAGE = STICKER (OCR)
        console.log(`Processing sticker for ${chatId}`);
        await bot.sendMessage(chatId, "🔍 Processing sticker image... This may take a moment.");
        
        const rawText = await extractText(filePath);
        console.log(`OCR Result for ${chatId}: ${rawText.substring(0, 100)}`);
        
        const parsed = parseText(rawText);
        
        const itemCode = `UEPL${ITEM_COUNTER++}`;
        saveCounter();
        
        const finalImage = await brandImage(user.fabricImage, itemCode);
        
        // Get public URL
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const imageUrl = `${baseUrl}/${path.basename(finalImage)}`;
        
        await axios.post(SHEET_URL, {
          code: itemCode,
          name: parsed.name,
          gsm: parsed.gsm,
          supplier: parsed.supplier,
          count: parsed.count,
          rate: "",
          stock: parsed.width,
          image: imageUrl
        });
        
        // Cleanup
        try {
          if (fs.existsSync(user.fabricImage)) fs.unlinkSync(user.fabricImage);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch(e) { console.error('Cleanup error:', e); }
        user.fabricImage = null;
        
        console.log(`Saved item ${itemCode} for ${chatId}`);
        
        await bot.sendPhoto(chatId, finalImage, {
          caption: `✅ *Saved via OCR*\n\n*Code:* ${itemCode}\n*Name:* ${parsed.name}\n*GSM:* ${parsed.gsm}\n*Supplier:* ${parsed.supplier}\n\n*Raw OCR:*\n\`${rawText.substring(0, 200)}\``,
          parse_mode: 'Markdown'
        });
      });
      
    } catch (err) {
      console.error('Image processing error:', err);
      bot.sendMessage(chatId, "❌ Error processing image. Please try again.");
    }
    return;
  }
  
  // Default response for authenticated users
  if (text) {
    bot.sendMessage(chatId, "📱 Send fabric image (first), then sticker image with text (second)\n\nOr send an item code like UEPL123 to look it up.");
  }
});

// Error handler for bot
bot.on('polling_error', (error) => {
  console.log('Polling error:', error.code, error.message);
});

bot.on('error', (error) => {
  console.log('Bot error:', error);
});

// Start server
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Bot is running with polling mode`);
  console.log(`Web interface: http://localhost:${PORT}`);
  console.log(`========================================`);
});

// Send test message to bot owner (optional - add your chat ID)
console.log("Bot waiting for messages...");
