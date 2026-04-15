from flask import Flask, request, jsonify, render_template
from PIL import Image, ImageDraw
import base64, io, os, time, qrcode, gspread, json
from google.oauth2.service_account import Credentials

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

# 🔥 ENV-BASED AUTH (NO FILE)
creds_dict = json.loads(os.environ.get("GOOGLE_CREDS"))

creds = Credentials.from_service_account_info(
    creds_dict,
    scopes=SCOPES
)

gc = gspread.authorize(creds)
sheet = gc.open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)


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

        # 🔥 CANVAS
        W,H = 1600,2000
        canvas = Image.new("RGB",(W,H),"white")
        draw = ImageDraw.Draw(canvas)

        draw.rectangle([5,5,W-5,H-5],outline="black",width=2)

        img.thumbnail((W-80,H-360))
        canvas.paste(img,((W-img.width)//2,30))

        # 🔥 TEXT
        draw.text((60,H-260), item_code, fill="black")

        # 🔥 QR
        qr = qrcode.make(item_code)
        qr = qr.resize((280,280))
        canvas.paste(qr,(W-330,H-330))

        # 🔥 SAVE LOCAL
        path = os.path.join(OUTPUT_DIR,f"{item_code}.jpg")
        canvas.save(path,"JPEG")

        # 🔥 UPLOAD TO DRIVE (SIMPLE)
        file = gc.client.request(
            "post",
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=media",
            data=open(path,"rb"),
            headers={"Content-Type":"image/jpeg"}
        )

        file_id = file.json()["id"]
        drive_link = f"https://drive.google.com/uc?id={file_id}"

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
