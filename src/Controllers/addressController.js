const db = require('../../db'); // Adjust path if needed
const Address = require('../Models/userAddressModel'); // Adjust path if needed

// GET / - Get all of a user's saved addresses, joining with users table for contact info
exports.getUserAddresses = async (req, res) => {
    const userId = req.user.id;
    // const userId = 1; // Placeholder for testing
    try {
        const query = `
            SELECT 
                ua.*,
                u.full_name,
                u.mobile_number
            FROM user_addresses ua
            JOIN users u ON ua.user_id = u.id
            WHERE ua.user_id = ? 
            ORDER BY ua.is_default DESC, ua.updated_at DESC
        `;
        const [rows] = await db.query(query, [userId]);
        const addresses = rows.map(row => new Address(row));
        res.status(200).json({ status: true, data: addresses });
    } catch (error) {
        console.error("Error fetching addresses:", error);
        res.status(500).json({ status: false, message: 'Failed to retrieve addresses.' });
    }
};

// POST /add - Add a new address for the user (Simplified: no name or phone)
exports.addAddress = async (req, res) => {
    const userId = req.user.id;
    // const userId = 1; // Placeholder for testing
    const { addressLine1, addressLine2, landmark, city, state, pincode, addressType, isDefault } = req.body;
    
    if (!addressLine1 || !city || !state || !pincode) {
        return res.status(400).json({ status: false, message: "Address Line 1, City, State, and Pincode are required." });
    }
    
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        
        // If the new address is set as default, first un-set any other default address.
        if (isDefault === true || isDefault === 'true') {
            await connection.query('UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?', [userId]);
        }

        const query = `
            INSERT INTO user_addresses 
            (user_id, address_line_1, address_line_2, landmark, city, state, pincode, address_type, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await connection.query(query, [
            userId, addressLine1, addressLine2 || null, landmark || null, city, state, pincode, addressType || 'Home', isDefault || false
        ]);
        
        await connection.commit();
        res.status(201).json({ status: true, message: 'Address added successfully.', addressId: result.insertId });

    } catch (error) {
        await connection.rollback();
        console.error("Error adding address:", error);
        res.status(500).json({ status: false, message: 'Failed to add address.' });
    } finally {
        connection.release();
    }
};

// PUT /update/:addressId - Update an existing address
exports.updateAddress = async (req, res) => {
    const userId = req.user.id;
    // const userId = 1; // Placeholder for testing
    const { addressId } = req.params;
    const { addressLine1, addressLine2, landmark, city, state, pincode, addressType } = req.body;
    
    const fieldsToUpdate = [];
    const values = [];

    // Dynamically build the SET part of the query based on fields provided in the request
    if (addressLine1) { fieldsToUpdate.push('address_line_1 = ?'); values.push(addressLine1); }
    if (addressLine2 !== undefined) { fieldsToUpdate.push('address_line_2 = ?'); values.push(addressLine2); }
    if (landmark !== undefined) { fieldsToUpdate.push('landmark = ?'); values.push(landmark); }
    if (city) { fieldsToUpdate.push('city = ?'); values.push(city); }
    if (state) { fieldsToUpdate.push('state = ?'); values.push(state); }
    if (pincode) { fieldsToUpdate.push('pincode = ?'); values.push(pincode); }
    if (addressType) { fieldsToUpdate.push('address_type = ?'); values.push(addressType); }

    if (fieldsToUpdate.length === 0) {
        return res.status(400).json({ status: false, message: 'No fields provided to update.' });
    }

    const query = `UPDATE user_addresses SET ${fieldsToUpdate.join(', ')} WHERE id = ? AND user_id = ?`;
    values.push(addressId, userId);

    try {
        const [result] = await db.query(query, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'Address not found or you do not have permission to edit it.' });
        }
        res.status(200).json({ status: true, message: 'Address updated successfully.' });
    } catch (error) {
        console.error("Error updating address:", error);
        res.status(500).json({ status: false, message: 'Failed to update address.' });
    }
};

// DELETE /delete/:addressId - Delete an address
exports.deleteAddress = async (req, res) => {
    const userId = req.user.id;
    // const userId = 1; // Placeholder for testing
    const { addressId } = req.params;
    try {
        const query = 'DELETE FROM user_addresses WHERE id = ? AND user_id = ?';
        const [result] = await db.query(query, [addressId, userId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'Address not found or you do not have permission to delete it.' });
        }
        res.status(200).json({ status: true, message: 'Address deleted successfully.' });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ status: false, message: 'Cannot delete this address as it is linked to your KYC profile.' });
        }
        console.error("Error deleting address:", error);
        res.status(500).json({ status: false, message: 'Failed to delete address.' });
    }
};

// PATCH /set-default/:addressId - Set an address as the default one
exports.setDefaultAddress = async (req, res) => {
    const userId = req.user.id;
    // const userId = 1; // Placeholder for testing
    const { addressId } = req.params;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        // Step 1: Un-set all other addresses as default for this user
        await connection.query('UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?', [userId]);
        // Step 2: Set the specified address as the default
        const [result] = await connection.query('UPDATE user_addresses SET is_default = TRUE WHERE id = ? AND user_id = ?', [addressId, userId]);
        
        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: 'Address not found or you do not have permission to edit it.' });
        }

        await connection.commit();
        res.status(200).json({ status: true, message: 'Default address updated successfully.' });
    } catch (error) {
        await connection.rollback();
        console.error("Error setting default address:", error);
        res.status(500).json({ status: false, message: 'Failed to set default address.' });
    } finally {
        connection.release();
    }
};