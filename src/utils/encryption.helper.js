const crypto = require('crypto');

// Store this securely in your .env file
// ENCRYPTION_KEY must be 32 chars
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012'; 
const IV_LENGTH = 16; // For AES, this is always 16

exports.encryptObject = (object) => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(JSON.stringify(object));
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return { 
        encryptedData: encrypted.toString('hex'), 
        iv: iv.toString('hex') 
    };
};

exports.decryptObject = ({ encryptedData, iv }) => {
    let ivBuffer = Buffer.from(iv, 'hex');
    let encryptedText = Buffer.from(encryptedData, 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), ivBuffer);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString());
};