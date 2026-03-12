const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const multer = require("multer");
const cors = require("cors");
const baseUrl = process.env.BASE_URL || "https://order-form-backend-cm2i.onrender.com";
// Load .env locally (Render uses dashboard env vars)
try {
  require("dotenv").config();
} catch {
  // ignore
}
// Debug: check which API key server is using
console.log("Using API key:", process.env.RESEND_API_KEY);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

// Ensure directories exist
function ensureDir(dirPath) {
  if (!fssync.existsSync(dirPath)) {
    fssync.mkdirSync(dirPath, { recursive: true });
  }
}

ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);

app.use(
  cors({
    origin: true,
    credentials: false,
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Optional: expose uploaded images (for admin review/debug)
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^\w.\- ]+/g, "")
      .replace(/\s+/g, "-");
    const ext = path.extname(safeBase) || "";
    const base = ext ? safeBase.slice(0, -ext.length) : safeBase;
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${file.fieldname}-${base || "upload"}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp" ||
      file.mimetype === "image/gif";
    cb(ok ? null : new Error("Only image uploads are allowed."), ok);
  },
});

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Read orders.json safely
async function readOrders() {
  try {
    const data = await fs.readFile(ORDERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Write orders.json safely
async function writeOrders(orders) {
  await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
}

// Send email using Resend API
async function sendAdminEmail(order) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;

    const imageLink = order.image
      ? `${baseUrl}${order.image.urlPath}`
      : "No image uploaded";

    const text = [
      "New fashion design submission",
      "",
      `Name: ${order.name || ""}`,
      `Email: ${order.email || ""}`,
      `Measurement: ${order.measurement || ""}`,
      "",
      `Design: ${order.design || ""}`,
      `Style1: ${order.style1 || ""}`,
      `Style2: ${order.style2 || ""}`,
      "",
      "Gallery images:",
      ...(toArray(order.gallery).map((f) => `${baseUrl}${f}`)),
      "",
      "Fabrics images:",
      ...(toArray(order.fabrics).map((f) => `${baseUrl}${f}`)),
      "",
      `Image uploaded: ${imageLink}`,
      "",
      "Description:",
      `${order.description || ""}`,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Orders-onboarding@resend.dev",
        to: adminEmail,
        subject: `New order form submission: ${order.name || "Unknown"}`,
        text,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Resend API error: ${res.status} ${errorText}`);
    }

    return { sent: true };
  } catch (err) {
    console.error("Resend email failed:", err);
    return { sent: false, reason: err.message };
  }
}

// Order submission endpoint
app.post(
  "/submit-order",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "gallery", maxCount: 10 },
    { name: "fabrics", maxCount: 10 },
  ]),
  async (req, res) => {
  try {
    const {
      name,
      email,
      measurement,
      gallery,
      design,
      fabrics,
      description,
      style1,
      style2,
    } = req.body;

  const imageFile = req.files?.image?.[0] || null;
const galleryFiles = req.files?.gallery || [];
const fabricsFiles = req.files?.fabrics || [];
   const order = {
  id: `ord_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
  name: name ?? "",
  email: email ?? "",
  measurement: measurement ?? "",
  design: design ?? "",

  gallery: galleryFiles.map((f) => `/uploads/${f.filename}`),
  fabrics: fabricsFiles.map((f) => `/uploads/${f.filename}` ),

  description: description ?? "",
  style1: style1 ?? "",
  style2: style2 ?? "",

  image: imageFile
    ? {
            originalName: imageFile.originalname,
            fileName: imageFile.filename,
            mimeType: imageFile.mimetype,
            size: imageFile.size,
            urlPath: `/uploads/${imagaFile.filename}`,
          }
        : null,
      createdAt: new Date().toISOString(),
    };

    // Save order immediately (fast)
    const orders = await readOrders();
    orders.push(order);
    await writeOrders(orders);

    // Send email in the background (does not block submission — 3x faster)
    sendAdminEmail(order).catch((emailErr) => {
      console.error("Email send failed:", emailErr?.message || emailErr);
    });

    res.status(200).json({ success: true, orderId: order.id });
  } catch (err) {
    console.error("Submission failed:", err);
    const message =
      err && err.message ? err.message : "Server error processing submission";
    res.status(500).json({ success: false, message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
