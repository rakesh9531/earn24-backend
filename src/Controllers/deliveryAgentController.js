const db = require('../../db');
const DeliveryAgent = require('../Models/DeliveryAgent');
const bcrypt = require('bcrypt');
const saltRounds = 10; // Standard for bcrypt hashing

/**
 * GET / - Get all delivery agents for the management page
 */
exports.getAllAgents = async (req, res) => {
    try {
        const query = "SELECT id, full_name, phone_number, is_active, created_at, updated_at FROM delivery_agents ORDER BY created_at DESC";
        const [rows] = await db.query(query);
        const agents = rows.map(agent => new DeliveryAgent(agent));
        res.status(200).json({ status: true, data: agents });
    } catch (error) {
        console.error("Error fetching delivery agents:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * POST /create - Create a new delivery agent
 */
exports.createAgent = async (req, res) => {
    const { fullName, phoneNumber, password, isActive } = req.body;

    if (!fullName || !phoneNumber || !password) {
        return res.status(400).json({ status: false, message: "Full Name, Phone Number, and Password are required." });
    }

    try {
        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const query = "INSERT INTO delivery_agents (full_name, phone_number, password, is_active) VALUES (?, ?, ?, ?)";
        const [result] = await db.query(query, [fullName, phoneNumber, hashedPassword, isActive === true || isActive === 'true']);
        
        res.status(201).json({ status: true, message: "Delivery agent created successfully.", agentId: result.insertId });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "A delivery agent with this phone number already exists." });
        }
        console.error("Error creating delivery agent:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * PUT /update/:agentId - Update an agent's details
 */
exports.updateAgent = async (req, res) => {
    const { agentId } = req.params;
    const { fullName, phoneNumber } = req.body;

    const fieldsToUpdate = [];
    const values = [];

    if (fullName) { fieldsToUpdate.push('full_name = ?'); values.push(fullName); }
    if (phoneNumber) { fieldsToUpdate.push('phone_number = ?'); values.push(phoneNumber); }
    
    if (fieldsToUpdate.length === 0) {
        return res.status(400).json({ status: false, message: "No fields provided to update." });
    }

    values.push(agentId);
    const query = `UPDATE delivery_agents SET ${fieldsToUpdate.join(', ')} WHERE id = ?`;

    try {
        const [result] = await db.query(query, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Delivery agent not found." });
        }
        res.status(200).json({ status: true, message: "Agent details updated successfully." });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: false, message: "This phone number is already in use by another agent." });
        }
        console.error("Error updating agent:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * PATCH /toggle-status/:agentId - Activate or deactivate an agent
 */
exports.toggleAgentStatus = async (req, res) => {
    const { agentId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
        return res.status(400).json({ status: false, message: "A valid 'isActive' status (true or false) is required." });
    }

    try {
        const query = "UPDATE delivery_agents SET is_active = ? WHERE id = ?";
        const [result] = await db.query(query, [isActive, agentId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Delivery agent not found." });
        }
        res.status(200).json({ status: true, message: `Agent status updated to ${isActive ? 'Active' : 'Inactive'}.` });
    } catch (error) {
        console.error("Error updating agent status:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};

/**
 * DELETE /delete/:agentId - Delete an agent
 */
exports.deleteAgent = async (req, res) => {
    const { agentId } = req.params;
    try {
        const query = "DELETE FROM delivery_agents WHERE id = ?";
        const [result] = await db.query(query, [agentId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: "Delivery agent not found." });
        }
        res.status(200).json({ status: true, message: "Delivery agent deleted successfully." });
    } catch (error) {
        // This handles if you try to delete an agent who is assigned to an active order
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ status: false, message: 'Cannot delete this agent as they are assigned to one or more orders.' });
        }
        console.error("Error deleting agent:", error);
        res.status(500).json({ status: false, message: "An error occurred." });
    }
};