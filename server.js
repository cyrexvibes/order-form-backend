const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const multer = require("multer");
const cors = require("cors");

try {
  require("dotenv").config();
} catch {}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const baseUrl =
  process.env.BASE_URL ||
  "https://order-form-backend-cm2i.onrender.com";

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

app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});
// ADD THESE TWO LINES
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/img", express.static(path.join(__dirname, "img")));

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
    const unique =  `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

    cb(null, `${file.fieldname}-${base || "upload"}-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp" ||
      file.mimetype === "image/gif";

    cb(ok ? null : new Error("Only image uploads allowed"), ok);
  },
});

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

async function readOrders() {
  try {
    const data = await fs.readFile(ORDERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeOrders(orders) {
  await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
}

async function sendAdminEmail(order) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;

    const imageLink = order.image
      ? `${baseUrl}${order.image.urlPath}`
      : "No image uploaded";

    const galleryLinks = toArray(order.gallery)
      .map((f) => `${baseUrl}${f}`)
      .join("\n");

    const fabricLinks = toArray(order.fabrics)
      .map((f) => `${baseUrl}${f}`)
      .join("\n");

    const text = `
New fashion design submission

Name: ${order.name || ""}
Email: ${order.email || ""}
Measurement: ${order.measurement || ""}

Design: ${order.design || ""}
Style1: ${order.style1 || ""}
Style2: ${order.style2 || ""}

Gallery images:
${galleryLinks || "None"}

Fabric images:
${fabricLinks || "None"}

Uploaded image:
${imageLink}

Description:
${order.description || ""}
`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Orders <onboarding@resend.dev>",
        to: adminEmail,
        subject: `New order form submission: ${order.name || "Unknown"}`,
        text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    return { sent: true };
  } catch (err) {
    console.error("Email failed:", err);
    return { sent: false };
  }
}

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
        design,
        description,
        style1,
        style2,
      } = req.body;

      const imageFile = req.files?.image?.[0] || null;

      const galleryUploaded = (req.files?.gallery || []).map(
        (f) => `/uploads/${f.filename}`
      );

      const fabricsUploaded = (req.files?.fabrics || []).map(
        (f) => `/uploads/${f.filename}`
      );

      const gallerySelections = toArray(req.body.gallery);
      const fabricsSelections = toArray(req.body.fabrics);

      const allGallery = [...galleryUploaded, ...gallerySelections];
      const allFabrics = [...fabricsUploaded, ...fabricsSelections];

      const order = {
        id: `ord_${Date.now()}_${Math.round(Math.random() * 1e9)}`,
        name: name || "",
        email: email || "",
        measurement: measurement || "",
        design: design || "",
        gallery: allGallery,
        fabrics: allFabrics,
        description: description || "",
        style1: style1 || "",
        style2: style2 || "",
        image: imageFile
          ? {
              originalName: imageFile.originalname,
              fileName: imageFile.filename,
              mimeType: imageFile.mimetype,
              size: imageFile.size,
              urlPath: `/uploads/${imageFile.filename}`,
            }
          : null,
        createdAt: new Date().toISOString(),
      };

      const orders = await readOrders();
      orders.push(order);
      await writeOrders(orders);

      sendAdminEmail(order);

      res.status(200).json({
        success: true,
        orderId: order.id,
      });
    } catch (err) {
      console.error("Submission error:", err);

      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
