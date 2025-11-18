const fs = require('fs');
const path = require('path');

const getRelativeUrl = (file) => {
    if (!file) return null;
    const fullPath = file.path;
    const uploadsIndex = fullPath.indexOf('uploads');
    if (uploadsIndex === -1) return null;
    return '/' + fullPath.substring(uploadsIndex).replace(/\\/g, '/');
};

const deleteFile = (filePath) => {
    if (!filePath) return;
    const fullPath = path.join(process.cwd(), filePath.startsWith('/') ? filePath.substring(1) : filePath);
    if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
            if (err) console.error("Error deleting file:", fullPath, err);
        });
    }
};

module.exports = { getRelativeUrl, deleteFile };