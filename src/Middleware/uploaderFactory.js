// Middleware/uploaderFactory.js

const multer = require('multer');
const path = require('path');
const fs = require('fs');

/**
 * Creates a Multer upload middleware configured for a specific destination subfolder.
 * @param {string} subfolder - The name of the subfolder inside 'uploads' (e.g., 'logos', 'products').
 * @returns {multer} - The configured Multer instance.
 */
const createUploader = (subfolder) => {
  const rootUploadsDir = path.join(__dirname, '../uploads');
  const destinationPath = path.join(rootUploadsDir, subfolder);

  if (!fs.existsSync(destinationPath)) {
    fs.mkdirSync(destinationPath, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, destinationPath);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });

  const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type! Please upload only images.'), false);
    }
  };

  return multer({ 
    storage: storage, 
    fileFilter: fileFilter,
    limits: { fileSize: 1024 * 1024 * 5 } // 5MB file size limit
  });
};

module.exports = createUploader;