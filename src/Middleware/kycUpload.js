// src/Middleware/kycUpload.js
// Dedicated multer middleware for KYC document uploads
// Accepts: pan_card_doc, aadhaar_card_doc, bank_passbook_doc

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const KYC_UPLOAD_DIR = path.join(__dirname, '../uploads/kyc-docs');

// Ensure directory exists
if (!fs.existsSync(KYC_UPLOAD_DIR)) {
  fs.mkdirSync(KYC_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, KYC_UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const userId = req.user?.id || 'unknown';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // e.g. pan_card_doc-userId-123-timestamp.jpg
    cb(null, `${file.fieldname}-user${userId}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG images or PDF files are allowed for KYC documents.'), false);
  }
};

const kycUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB per file
});

// Upload all 3 KYC document fields at once
const kycDocUpload = kycUpload.fields([
  { name: 'pan_card_doc', maxCount: 1 },
  { name: 'aadhaar_card_doc', maxCount: 1 },
  { name: 'bank_passbook_doc', maxCount: 1 }
]);

module.exports = { kycDocUpload, KYC_UPLOAD_DIR };
