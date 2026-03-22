const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const multer = require("multer");
const cors = require("cors");

try { require("dotenv").config(); } catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;
const baseUrl = "https://order-form-backend-cm2i.onrender.com";

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fssync.existsSync(UPLOADS_DIR)) fssync.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/images", express.static(path.join(__dirname, "images")));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "-"))
  })
});

async function sendAdminEmail(order) {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    const adminEmail = process.env.ADMIN_EMAIL;

    const formatLinks = (input) => {
      if (!input || input === "") return "None";
      const items = typeof input === "string" ? input.split(",").filter(x => x.trim() !== "") : input;
      return items.map(f => ${baseUrl}/images/${f}).join("\n");
    };

    const galleryText = formatLinks(order.gallery);
    const fabricText = formatLinks(order.fabrics);
    const uploadText = order.image ? ${baseUrl}${order.image} : "No image uploaded";

    const emailBody = New Order Submission\n\nName: ${order.name}\nEmail: ${order.email}\n\nGallery:\n${galleryText}\n\nFabrics:\n${fabricText}\n\nUploaded Image:\n${uploadText};

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": Bearer ${resendKey} },
      body: JSON.stringify({
        from: "Orders <onboarding@resend.dev>",
        to: adminEmail,
        subject: New Order from ${order.name},
        text: emailBody
      })
    });
    console.log("Email triggered.");
  } catch (err) {
    console.error("Email Error:", err);
  }
}

app.post("/submit-order", upload.fields([{ name: "image", maxCount: 1 }]), async (req, res) => {
  try {
    const { name, email, gallery, fabrics } = req.body;
    
    const order = {
      name: name || "Customer",
      email: email || "No Email",
      gallery: gallery || "", 
      fabrics: fabrics || "",
      image: req.files?.image ? /uploads/${req.files.image[0].filename} : null
    };

    // This sends the email in the background
    sendAdminEmail(order);

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.listen(PORT, () => console.log("Live"));
