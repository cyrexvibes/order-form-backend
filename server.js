const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const cors = require("cors");

// Load .env locally (Render uses dashboard env vars)
try {
  require("dotenv").config();
} catch {
  // ignore
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

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

// Optional: expose uploaded images (useful for debugging/admin review)
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

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
    // allow common image types; your field name must be `image`
    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp" ||
      file.mimetype === "image/gif";
    cb(ok ? null : new Error("Only image uploads are allowed."), ok);
  },
});

async function readOrders() {
  try {
    const raw = await fs.readFile(ORDERS_FILE, "utf8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    // If JSON got corrupted, don’t crash the server
    return [];
  }
}

async function writeOrders(orders) {
  const tmp = `${ORDERS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(orders, null, 2), "utf8");
  await fs.rename(tmp, ORDERS_FILE);
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS
  );
}

async function sendAdminEmail(order) {
  // Don’t crash the app if SMTP isn’t set (common on first deploy)
  if (!smtpConfigured()) {
    return { sent: false, reason: "SMTP not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true", // true for 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  const subject = `New order form submission: ${order.name || "Unknown"}`;

  const text = [
    "New fashion design submission",
    "",
    `Name: ${order.name || ""}`,
    `Email: ${order.email || ""}`,
    `Measurement: ${order.measurement || ""}`,
    "",
    `Gallery: ${toArray(order.gallery).join(", ") || ""}`,
    `Design: ${order.design || ""}`,
    `Fabrics: ${toArray(order.fabrics).join(", ") || ""}`,
    "",
    `Style1: ${order.style1 || ""}`,
    `Style2: ${order.style2 || ""}`,
    "",
    "Description:",
    `${order.description || ""}`,
    "",
    `Image uploaded: ${order.image ? "Yes" : "No"}`,
    order.image ? `Image filename: ${order.image.fileName}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: adminEmail,
    subject,
    text,
  });

  return { sent: true };
}

// IMPORTANT: field names match your form EXACTLY:
// name, email, measurement, gallery, design, fabrics, description, image, style1, style2
app.post("/submit-order", upload.single("image"), async (req, res) => {
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

    const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

    const file = req.file || null;
    const order = {
      id: `ord_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
      name: name ?? "",
      email: email ?? "",
      measurement: measurement ?? "",
      gallery: toArray(gallery),
      design: design ?? "",
      fabrics: toArray(fabrics),
      description: description ?? "",
      style1: style1 ?? "",
      style2: style2 ?? "",
      image: file
        ? {
            originalName: file.originalname,
            fileName: file.filename,
            mimeType: file.mimetype,
            size: file.size,
            urlPath: `/uploads/${file.filename}`,
          }
        : null,
      createdAt: new Date().toISOString(),
    };

    const orders = await readOrders();
    orders.push(order);
    await writeOrders(orders);

  // Send email in the background, don’t delay the response
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
