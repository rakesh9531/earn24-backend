// src/Services/binaryService.js
const db = require("../../db");

/**
 * Finds the extreme downline placement ID (Spillover Logic)
 * Traverses down the selected leg (LEFT or RIGHT) to find the first empty spot.
 */
exports.findPlacementParent = async (connection, sponsorId, preferredPosition) => {
    let currentId = sponsorId;
    const position = preferredPosition === 'LEFT' ? 'LEFT' : 'RIGHT';

    while (true) {
        const [rows] = await connection.query(
            "SELECT id FROM users WHERE binary_placement_id = ? AND binary_position = ?",
            [currentId, position]
        );
        
        if (rows.length === 0) {
            // Found the extreme empty position!
            return { placementParentId: currentId, position };
        }
        
        // Move deeper into the leg
        currentId = rows[0].id;
    }
};

/**
 * Traverses upline path through binary placement parent, accumulates BV,
 * and records detailed entries for level-based binary matching.
 */
exports.addBVToBinaryUpline = async (connection, buyerId, bvAmount, orderId) => {
    if (bvAmount <= 0) return;

    // First fetch the buyer's placement details
    const [buyerRows] = await connection.query("SELECT binary_placement_id, binary_position FROM users WHERE id = ?", [buyerId]);
    if (!buyerRows.length) return;

    let parentId = buyerRows[0].binary_placement_id;
    let currentPosition = buyerRows[0].binary_position;
    let depth = 1;

    while (parentId) {
        // 1. Update total leg BV in users table (Legacy compatibility & fast dashboard reads)
        if (currentPosition === 'LEFT') {
            await connection.query("UPDATE users SET left_leg_bv = left_leg_bv + ? WHERE id = ?", [bvAmount, parentId]);
            console.log(`[Binary BV] Added ${bvAmount} BV to Left Leg of User ID ${parentId} (Level: ${depth})`);
        } else if (currentPosition === 'RIGHT') {
            await connection.query("UPDATE users SET right_leg_bv = right_leg_bv + ? WHERE id = ?", [bvAmount, parentId]);
            console.log(`[Binary BV] Added ${bvAmount} BV to Right Leg of User ID ${parentId} (Level: ${depth})`);
        }

        // 2. Insert detailed entry in user_binary_bv_entries ledger
        await connection.query(
            `INSERT INTO user_binary_bv_entries (user_id, source_user_id, order_id, bv_amount, leg, depth) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [parentId, buyerId, orderId || 0, bvAmount, currentPosition, depth]
        );

        // Fetch the parent's placement to keep going up
        const [parentRows] = await connection.query("SELECT binary_placement_id, binary_position FROM users WHERE id = ?", [parentId]);
        if (!parentRows.length) break;

        currentPosition = parentRows[0].binary_position;
        parentId = parentRows[0].binary_placement_id;
        depth++;
    }
};
