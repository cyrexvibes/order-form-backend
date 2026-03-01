// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer setup for file uploads (handles `image` field)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage });

// Parse URL-encoded and JSON bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Nodemailer setup (configure via .env)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,          // e.g. "smtp.gmail.com"
    port: Number(process.env.SMTP_PORT),  // e.g. 587
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
    auth: {
        user: process.env.SMTP_USER,      // your SMTP username/email
        pass: process.env.SMTP_PASS       // your SMTP password/app password
    }
});

// Helper: append order to JSON file
const ORDERS_FILE = path.join(__dirname, 'orders.json');
function saveOrder(order) {
    let data = [];
    if (fs.existsSync(ORDERS_FILE)) {
        try {
            const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
            if (raw.trim()) {
                data = JSON.parse(raw);
            }
        } catch (err) {
            console.error('Error reading existing orders.json:', err);
        }
    }
    data.push(order);
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// POST route that matches your form (change path if you want)
app.post('/submit-order', upload.single('image'), async (req, res) => {
    try {
        // Text fields – names MUST match your form exactly
        const {
            name,
            email,
            measurement,
            gallery,     // can be string or array depending on your form
            design,
            fabrics,     // can be string or array
            description,
            style1,
            style2
        } = req.body;

        // Uploaded file (may be undefined if user skipped image)
        const imageFile = req.file || null;

        // Normalize possible multi-select fields to arrays
        const toArray = (value) =>
            value == null
                ? []
                : Array.isArray(value)
                ? value
                : [value];

        const order = {
            name,
            email,
            measurement,
            gallery: toArray(gallery),
            design,
            fabrics: toArray(fabrics),
            description,
            style1,
            style2,
            image: imageFile
                ? {
                      originalName: imageFile.originalname,
                      fileName: imageFile.filename,
                      mimeType: imageFile.mimetype,
                      size: imageFile.size,
                      path: imageFile.path
                  }
                : null,
            createdAt: new Date().toISOString()
        };

        // 1) Save to JSON "database"
        saveOrder(order);

        // 2) Send email notification
        const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
        const subject = `New Fashion Design Order from ${name || 'Unknown'}`;

        const textBody = `
New fashion design submission:

Name: ${name || ''}
Email: ${email || ''}
Measurement: ${measurement || ''}

Gallery selection: ${toArray(gallery).join(', ') || 'None'}
Design: ${design || ''}
Fabrics: ${toArray(fabrics).join(', ') || 'None'}

Style 1: ${style1 || ''}
Style 2: ${style2 || ''}

Description:
${description || ''}

Image uploaded: ${imageFile ? 'Yes' : 'No'}
${imageFile ? `Image path: ${imageFile.path}` : ''}
        `.trim();

        await transporter.sendMail({
            from: `"Fashion Website" <${process.env.SMTP_USER}>`,
            to: adminEmail,
            subject,
            text: textBody
        });

        // 3) Respond to the browser
        res.status(200).json({ success: true, message: 'Order received successfully.' });
    } catch (err) {
        console.error('Error handling submission:', err);
        res.status(500).json({ success: false, message: 'Server error processing the form.' });
    }
});

// Start server 
app.listen(PORT, () => {
    console.log(Server running on port $ {PORT});
});
