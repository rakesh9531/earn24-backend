const db = require('../../db'); // Adjust the path to your db.js file if necessary

/**
 * Fetches all settings from the database.
 * This is used to populate the settings form in the admin panel.
 */
exports.getAllSettings = async (req, res) => {
    try {
        const query = "SELECT setting_key, setting_value, description FROM app_settings";
        const [settings] = await db.query(query);

        res.status(200).json({
            status: true,
            data: settings
        });
    } catch (error) {
        console.error("Error fetching application settings:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching settings." });
    }
};

/**
 * Updates multiple settings in a single transaction.
 * Expects a body with an array of settings objects:
 * [
 *   { "key": "profit_company_share_pct", "value": "25.00" },
 *   { "key": "bv_generation_pct_of_profit", "value": "75.00" }
 * ]
 */
// This is the new, intelligent update function with validation
exports.updateSettings = async (req, res) => {
    const settingsToUpdate = req.body; 

    if (!Array.isArray(settingsToUpdate) || settingsToUpdate.length === 0) {
        return res.status(400).json({ status: false, message: "Invalid request body. Expected an array of settings." });
    }

    // --- START OF VALIDATION LOGIC ---

    // 1. Convert the incoming array into an easy-to-use map object
    const settingsMap = settingsToUpdate.reduce((acc, setting) => {
        acc[setting.key] = parseFloat(setting.value);
        return acc;
    }, {});

    // 2. Validate the distribution percentages
    // IMPORTANT: Only validate if the request actually contains profit_dist_ keys.
    // If we are updating an unrelated setting (e.g., payout_mode, min_withdrawal_limit),
    // skip this validation entirely to avoid false errors.
    const distributionKeys = Object.keys(settingsMap).filter(key => key.startsWith('profit_dist_'));

    if (distributionKeys.length > 0) {
        const totalDistributionPct = distributionKeys.reduce((sum, key) => sum + settingsMap[key], 0);

        // Check if the sum of all distribution parts (cashback, sponsor, etc.) equals 100%
        // We use a small tolerance for floating point math issues.
        if (Math.abs(totalDistributionPct - 100.0) > 0.01) {
            return res.status(400).json({ 
                status: false, 
                message: `Validation Error: The sum of all distribution percentages must equal 100%. Current sum is ${totalDistributionPct.toFixed(2)}%.` 
            });
        }
    }

    // --- END OF VALIDATION LOGIC ---


    // If validation passes, proceed with the database update transaction
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const updatePromises = settingsToUpdate.map(setting => {
            const query = "UPDATE app_settings SET setting_value = ? WHERE setting_key = ?";
            // Note: We use the original string value for the DB, not the parsed float
            const originalSetting = settingsToUpdate.find(s => s.key === setting.key);
            return connection.query(query, [originalSetting.value, originalSetting.key]);
        });
        
        await Promise.all(updatePromises);
        await connection.commit();

        res.status(200).json({
            status: true,
            message: "Settings updated successfully."
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error updating application settings:", error);
        res.status(500).json({ status: false, message: "An error occurred while updating settings." });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};


exports.getDeliveryRules = async (req, res) => {
    try {
        // This query efficiently fetches only the specific keys we need.
        const deliveryKeys = [
            'delivery_fee_bv_threshold',
            'delivery_fee_standard',
            'delivery_fee_special'
        ];
        const query = "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?)";
        const [settings] = await db.query(query, [deliveryKeys]);

        if (settings.length < deliveryKeys.length) {
            console.error("Missing one or more delivery settings in the database.");
            return res.status(500).json({ status: false, message: "Server configuration error for delivery fees." });
        }

        // Transform the array into a structured object, just like your OrderSummaryScreen did.
        const settingsMap = settings.reduce((acc, setting) => {
            acc[setting.setting_key] = parseFloat(setting.setting_value);
            return acc;
        }, {});

        const deliverySettings = {
            threshold: settingsMap.delivery_fee_bv_threshold,
            standard: settingsMap.delivery_fee_standard,
            special: settingsMap.delivery_fee_special !== undefined ? settingsMap.delivery_fee_special : 0
        };

        res.status(200).json({ status: true, data: deliverySettings });

    } catch (error) {
        console.error("Error fetching delivery rules:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching delivery rules." });
    }
};

/**
 * Verify Security PIN for Payment Settings & Gateways (Default: 1234)
 */
exports.verifyPaymentPin = async (req, res) => {
    try {
        const { pin } = req.body;
        if (!pin) {
            return res.status(400).json({ status: false, message: "Security PIN is required." });
        }

        const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'payment_security_pin'");
        const currentPin = (rows[0] && rows[0].setting_value) ? rows[0].setting_value.trim() : '1234';

        if (String(pin).trim() !== currentPin) {
            return res.status(400).json({ status: false, message: "Incorrect Security PIN. Access denied." });
        }

        return res.status(200).json({ status: true, message: "Security PIN verified successfully." });
    } catch (error) {
        console.error("verifyPaymentPin error:", error);
        return res.status(500).json({ status: false, message: "Server error verifying security PIN." });
    }
};

/**
 * Change Security PIN for Payment Settings & Gateways
 */
exports.changePaymentPin = async (req, res) => {
    try {
        const { currentPin, newPin } = req.body;
        if (!newPin || String(newPin).trim().length < 4) {
            return res.status(400).json({ status: false, message: "New PIN must be at least 4 characters." });
        }

        const [rows] = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'payment_security_pin'");
        const dbPin = (rows[0] && rows[0].setting_value) ? rows[0].setting_value.trim() : '1234';

        if (String(currentPin || '').trim() !== dbPin) {
            return res.status(400).json({ status: false, message: "Current Security PIN is incorrect." });
        }

        const cleanNewPin = String(newPin).trim();
        await db.query(
            `INSERT INTO app_settings (setting_key, setting_value, description) 
             VALUES ('payment_security_pin', ?, 'Security PIN for Payment Gateways and Delivery Rules') 
             ON DUPLICATE KEY UPDATE setting_value = ?`,
            [cleanNewPin, cleanNewPin]
        );

        return res.status(200).json({ status: true, message: "Security PIN updated successfully." });
    } catch (error) {
        console.error("changePaymentPin error:", error);
        return res.status(500).json({ status: false, message: "Server error changing security PIN." });
    }
};