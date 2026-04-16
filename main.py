from flask import Flask, request, jsonify, render_template
from PIL import Image, ImageDraw
import base64, io, os, time, qrcode, gspread
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

app = Flask(__name__)

# 🔥 CONFIG
OUTPUT_DIR = "OUTPUT"
os.makedirs(OUTPUT_DIR, exist_ok=True)

SPREADSHEET_ID = "1VoshxbwMAuh6rApz9uwak0ojhnz93mKuZPInCmTq_c0"
SHEET_NAME = "UEPL_DB"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

# 🔥 OAUTH
creds = Credentials(
    None,
    refresh_token=os.environ.get("GOOGLE_REFRESH_TOKEN"),
    token_uri="https://oauth2.googleapis.com/token",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    scopes=SCOPES
)

if creds.expired and creds.refresh_token:
    creds.refresh(Request())

gc = gspread.authorize(creds)
sheet = gc.open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)

drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)


# 🔥 HOME
@app.route("/")
def home():
    return render_template("index.html")


# 🔥 SAVE ENTRY
@app.route("/render", methods=["POST"])
def render():

    data = request.json
    entries = data.get("entries", [])

    for item in entries:

        image_data = item.get("image")
        item_code = item.get("item")

        if not image_data or not item_code:
            continue

        header, encoded = image_data.split(",",1)
        img = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")

        # 🔥 CANVAS SETTINGS
        W, H = 1600, 2000
        SIDE_PAD = 40
        TOP_PAD = 40
        BOTTOM_PANEL = 320

        canvas = Image.new("RGB", (W, H), "white")
        draw = ImageDraw.Draw(canvas)

        # outer border
        draw.rectangle([5,5,W-5,H-5], outline="black", width=2)

        # 🔥 IMAGE AREA (FULL UTILIZATION - FIXED)
        IMG_AREA_W = W - 2*SIDE_PAD
        IMG_AREA_H = H - BOTTOM_PANEL - TOP_PAD

        img_ratio = img.width / img.height
        area_ratio = IMG_AREA_W / IMG_AREA_H

        if img_ratio > area_ratio:
            new_w = IMG_AREA_W
            new_h = int(new_w / img_ratio)
        else:
            new_h = IMG_AREA_H
            new_w = int(new_h * img_ratio)

        img_resized = img.resize((new_w, new_h), Image.LANCZOS)

        x = (W - new_w) // 2
        y = TOP_PAD + (IMG_AREA_H - new_h) // 2

        canvas.paste(img_resized, (x, y))

        # 🔥 BOTTOM PANEL LINE
        draw.line([(0, H - BOTTOM_PANEL), (W, H - BOTTOM_PANEL)], fill="black", width=3)

        # 🔥 QR (RIGHT)
        qr = qrcode.make(item_code)
        qr = qr.resize((250,250))
        canvas.paste(qr, (W - 300, H - 280))

        # 🔥 LOGO (LEFT)
        try:
            logo = Image.open("static/logo.png").convert("RGBA")
            logo.thumbnail((220,220))
            canvas.paste(logo, (40, H - 280), logo)
        except:
            pass

        # 🔥 TEXT (LEFT BOTTOM)
        draw.text((40, H - 70), "Offices of Nawnit Nihal", fill="black")
        draw.text((40, H - 110), item_code, fill="black")

        # 🔥 SAVE LOCAL
        path = os.path.join(OUTPUT_DIR,f"{item_code}.jpg")
        canvas.save(path,"JPEG")

        # 🔥 UPLOAD TO DRIVE
        file_metadata = {"name": f"{item_code}.jpg"}
        media = MediaFileUpload(path, mimetype="image/jpeg")

        file = drive_service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id"
        ).execute()

        file_id = file.get("id")

        # 🔥 MAKE PUBLIC
        drive_service.permissions().create(
            fileId=file_id,
            body={"role": "reader", "type": "anyone"}
        ).execute()

        # 🔥 FIXED PREVIEW LINK
        drive_link = f"https://drive.google.com/thumbnail?id={file_id}"

        # 🔥 SAVE TO SHEET
        sheet.append_row([
            item_code,
            item.get("count",""),
            item.get("construction",""),
            item.get("composition",""),
            item.get("weight",""),
            item.get("width",""),
            item.get("availability","YES"),
            drive_link,
            time.strftime("%Y-%m-%d %H:%M:%S")
        ])

    return jsonify({"ok":True})


# 🔥 REPORT
@app.route("/report/available")
def report():

    data = sheet.get_all_values()

    if len(data) <= 1:
        return jsonify({"data":[]})

    rows = data[1:]
    result = []

    for row in rows:
        result.append({
            "item": row[0],
            "count": row[1],
            "construction": row[2],
            "composition": row[3],
            "weight": row[4],
            "width": row[5],
            "availability": row[6],
            "image": row[7]
        })

    return jsonify({"data":result})


# 🔥 START
if __name__ == "__main__":
    port = int(os.environ.get("PORT",10000))
    app.run(host="0.0.0.0", port=port)
