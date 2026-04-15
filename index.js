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

// Use webhook instead of polling to avoid conflicts
const bot = new TelegramBot(process.env.BOT_TOKEN);
const app = express();

// Set webhook
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || `https://uepl-bot.onrender.com`;
bot.setWebHook(`${WEBHOOK_URL}/webhook`);

// Parse JSON bodies
app.use(express.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Serve static files
app.use(express.static(__dirname));

// API endpoint
app.get('/api/items', async (req, res) => {
  try {
    const response = await axios.get(SHEET_URL + "?code=ALL");
    res.json(response.data);
  } catch (err) {
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

const users = {};
let ITEM_COUNTER = 1;

// HELPERS
function isItemCode(text) {
  return /^UEPL\d+$/.test(text);
}

function generateQR(itemCode) {
  return itemCode;
}

// IMPROVED OCR WITH MULTIPLE PREPROCESSING STRATEGIES
async function extractText(imagePath) {
  const strategies = [
    async () => {
      // Strategy 1: High contrast + sharpening
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
      fs.unlinkSync(processed);
      return text;
    },
    async () => {
      // Strategy 2: Binarization
      const processed = imagePath.replace(".jpg", "_v2.jpg");
      await sharp(imagePath)
        .grayscale()
        .threshold(128)
        .toFile(processed);
      const { data: { text } } = await Tesseract.recognize(processed, 'eng');
      fs.unlinkSync(processed);
      return text;
    },
    async () => {
      // Strategy 3: Original but with contrast enhancement
      const processed = imagePath.replace(".jpg", "_v3.jpg");
      await sharp(imagePath)
        .normalize()
        .modulate({ brightness: 1.2, contrast: 1.3 })
        .toFile(processed);
      const { data: { text } } = await Tesseract.recognize(processed, 'eng');
      fs.unlinkSync(processed);
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

// IMPROVED PARSER WITH MORE PATTERNS
function parseText(text) {
  text = text.toUpperCase();
  
  // Clean text
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

// QR READ
async function detectQR(filePath) {
  try {
    const img = await loadImage(filePath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height);
    const code = jsQR(data.data, img.width, img.height);
    return code ? code.data : null;
  } catch (err) {
    return null;
  }
}

// IMPROVED BRAND IMAGE WITH ERROR HANDLING
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
    
    // Resize QR if needed
    const qrImage = await sharp(qrBuffer).resize(150, 150).toBuffer();
    const logoBuffer = fs.existsSync(logoPath) ? await sharp(logoPath).resize(80, 80).toBuffer() : null;
    
    // Create white background
    const output = inputPath.replace(".jpg", "_final.jpg");
    
    const compositeOps = [
      { input: await base.toBuffer(), top: padding, left: padding }
    ];
    
    // Add QR code
    compositeOps.push({ 
      input: qrImage, 
      top: meta.height + padding + 20, 
      left: newWidth - 170 
    });
    
    // Add logo if exists
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

// BOT LOGIC
bot.on('message', async (msg) => {
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
  }

  // AUTH
  if (!user.auth) {
    if (text === PASSWORD) {
      user.auth = true;
      user.time = Date.now();
      return bot.sendMessage(chatId, "✅ Authenticated! Send fabric image first, then sticker image.");
    }
    return bot.sendMessage(chatId, "🔒 Send password to continue.");
  }

  // ITEM CODE ENQUIRY
  if (text && isItemCode(text)) {
    try {
      const res = await axios.get(`${SHEET_URL}?code=${text}`);
      if (res.data === "NOT_FOUND") {
        return bot.sendMessage(chatId, "❌ Item not found");
      }
      
      const d = res.data;
      
      await bot.sendPhoto(chatId, d.image, {
        caption: `📦 *Item Details*\n\n*Name:* ${d.name}\n*GSM:* ${d.gsm}\n*Supplier:* ${d.supplier}\n*Code:* ${d.code}`,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      bot.sendMessage(chatId, "❌ Error fetching item");
    }
    return;
  }

  // IMAGE FLOW
  if (msg.photo) {
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
          return bot.sendMessage(chatId, "📸 Fabric image saved. Now send the *sticker image* with text.", { parse_mode: 'Markdown' });
        }
        
        // SECOND IMAGE = STICKER (OCR)
        await bot.sendMessage(chatId, "🔍 Processing sticker image... This may take a moment.");
        
        const rawText = await extractText(filePath);
        const parsed = parseText(rawText);
        
        const itemCode = `UEPL${ITEM_COUNTER++}`;
        const finalImage = await brandImage(user.fabricImage, itemCode);
        
        // Get public URL
        const imageUrl = `${WEBHOOK_URL}/${path.basename(finalImage)}`;
        
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
        if (fs.existsSync(user.fabricImage)) fs.unlinkSync(user.fabricImage);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        user.fabricImage = null;
        
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
  
  bot.sendMessage(chatId, "📱 Send fabric image (first), then sticker image with text (second)");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}/webhook`);
});
