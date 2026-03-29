const express = require("express");
const path = require("path");
const fssync = require("fs"); // Used for the folder check
const multer = require("multer");
const cors = require("cors");

try { require("dotenv").config(); } catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;
const baseUrl = "https://order-form-backend-cm2i.onrender.com";

// --- FIX 1: THE SAFETY SHIELD (Folder Creation) ---
// This stops the ENOENT error by forcing the folder to exist
const UPLOADS_PATH = path.resolve(__dirname, "uploads");
if (!fssync.existsSync(UPLOADS_PATH)) {
    fssync.mkdirSync(UPLOADS_PATH, { recursive: true });
    console.log("Detective Moses: Created missing uploads folder!");
}

const IMAGES_PATH = path.resolve(__dirname, "images");
const IMG_PATH = path.resolve(__dirname, "img");

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// 2. Link the folders to the URL
app.use("/uploads", express.static(UPLOADS_PATH));
app.use("/images", express.static(IMAGES_PATH));
app.use("/img", express.static(IMG_PATH));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_PATH),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "-"))
  }),
  limits: { 
    fileSize: 15 * 1024 * 1024 // Increased to 15MB just in case
  }
});

async function sendAdminEmail(order) {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    const adminEmail = process.env.ADMIN_EMAIL;

    const formatLinks = (input) => {
      if (!input || input === "" || input === "None") return "None";
      // Splits by comma if it's a string, or handles it as an array
      const items = typeof input === "string" ? input.split(",").filter(x => x.trim() !== "") : input;
      return items.map(f => `${baseUrl}/images/${f.trim()}`).join("\n");
    };

    // --- FIX 2: MEASUREMENT VISIBILITY ---
    // Added clear labels so the email definitely shows the data
    const emailBody = `NEW ORDER SUBMISSION\n` +
      --------------------------\n +
      `Name: ${order.name}\n` +
      `Email: ${order.email}\n` +
      `Description: ${order.description}\n\n` + 
      `MEASUREMENTS DATA:\n${order.measurements}\n\n` + // Fixed label
      `Gallery Selections:\n${formatLinks(order.gallery)}\n\n` +
      `Fabric Selections:\n${formatLinks(order.fabrics)}\n\n` +
      `Manual Customer Upload:\n${order.image ? baseUrl + order.image : "No image uploaded"}`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "Orders <onboarding@resend.dev>",
        to: adminEmail,
        subject: `New Order: ${order.name}`,
        text: emailBody
      })
    });
    console.log("Email sent successfully to Admin");
  } catch (err) { 
    console.error("Email Error:", err); 
  }
}

app.post("/submit-order", upload.fields([{ name: "image", maxCount: 1 }]), async (req, res) => {
  try {
    // --- FIX 3: DATA CATCHER ---
    // Added console logs so you can see exactly what is arriving in Render Logs
    console.log("Incoming Body Data:", req.body); 

    const { name, email, gallery, fabrics, description, measurements } = req.body;
    
    const order = {
      name: name || "Customer",
      email: email || "No Email",
      description: description || "None",
      measurements: measurements || "No Measurements Sent", // This will show in email if empty
      gallery: gallery || "", 
      fabrics: fabrics || "",
      image: (req.files && req.files.image) ? `/uploads/${req.files.image[0].filename}` : null
    };

    await sendAdminEmail(order);
    res.status(200).json({ success: true, message: "Order Received" });
  } catch (err) { 
    console.error("Submit Error:", err);
    res.status(500).json({ success: false, error: err.message }); 
  }
});

app.listen(PORT, () => console.log("Final Server Live and Monitoring Folders"));
