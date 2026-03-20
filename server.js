const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const multer = require("multer");
const cors = require("cors");

try {
  require("dotenv").config();
} catch (e) {}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const baseUrl = process.env.BASE_URL || "https://order-form-backend-cm2i.onrender.com";

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function ensureDir(p) { if (!fssync.existsSync(p)) fssync.mkdirSync(p, { recursive: true }); }
ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/img", express.static(path.join(__dirname, "img")));

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

async function sendAdminEmail(order) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const resendKey = process.env.RESEND_API_KEY;

    const buildLinks = (arr) => toArray(arr)
      .filter(f => f && typeof f === 'string' && f.trim() !== "")
      .map(f => f.startsWith("/uploads/") ? `${baseUrl}${f} : ${baseUrl}/images/${f}`)
      .join("\n");

    const galleryLinks = buildLinks(order.gallery);
    const fabricLinks = buildLinks(order.fabrics);
    const imageLink = order.image ? `${baseUrl}${order.image.urlPath}` : "No image";

    const text = `New submission\nName: ${order.name}\nGallery:\n${galleryLinks}\nFabrics:\n${fabricLinks}\nUpload: ${imageLink}`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "Orders <onboarding@resend.dev>",
        to: adminEmail,
        subject: Order: `${order.name}`,
        text
      })
    });
  } catch (err) { console.error(err); }
}

const upload = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
})});

app.post("/submit-order", upload.fields([{name:"image"},{name:"gallery"},{name:"fabrics"}]), async (req, res) => {
  try {
    const { name, email, gallery, fabrics } = req.body;
    
    const parse = (val) => typeof val === 'string' ? val.split(',').filter(s => s.trim()) : toArray(val);
    
    const order = {
      id: Date.now(),
      name,
      gallery: [...(req.files?.gallery||[]).map(f=>`/uploads/${f.filename}`), ...parse(gallery)],
      fabrics: [...(req.files?.fabrics||[]).map(f=>`/uploads/${f.filename}`), ...parse(fabrics)],
      image: req.files?.image ? { urlPath: `/uploads/${req.files.image[0].filename}` } : null
    };

    const data = await fs.readFile(ORDERS_FILE, "utf-8").catch(()=>"[]");
    const orders = JSON.parse(data);
    orders.push(order);
    await fs.writeFile(ORDERS_FILE, JSON.stringify(orders));

    sendAdminEmail(order);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.listen(PORT, () => console.log("Live"));
