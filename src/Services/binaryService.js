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
 * Traverses upline path through unilevel placement parent, accumulates BV leg-wise,
 * and records detailed entries for depth-based multi-leg matching.
 */
exports.addBVToBinaryUpline = async (connection, buyerId, bvAmount, orderId) => {
    if (bvAmount <= 0) return;

    // Fetch buyer's placement details
    const [buyerRows] = await connection.query("SELECT binary_placement_id FROM users WHERE id = ?", [buyerId]);
    if (!buyerRows.length) return;

    let parentId = buyerRows[0].binary_placement_id;
    let childId = buyerId; // The child just below the parent, representing the leg/branch
    let currentDepth = 1;

    while (parentId) {
        const legUserId = childId;

        // 1. Insert detailed entry in user_binary_bv_entries ledger
        await connection.query(
            `INSERT INTO user_binary_bv_entries (user_id, source_user_id, leg_user_id, order_id, bv_amount, leg, depth, matched_amount) 
             VALUES (?, ?, ?, ?, ?, NULL, ?, 0.00)`,
            [parentId, buyerId, legUserId, orderId || 0, bvAmount, currentDepth]
        );
        console.log(`[MLM BV] Recorded ${bvAmount} BV for Parent ID ${parentId} from Buyer ID ${buyerId} under Leg Child ID ${legUserId} at relative depth ${currentDepth}`);

        // 2. Recompute and cache the parent's left_leg_bv (Strongest Leg) and right_leg_bv (Other legs combined)
        // This ensures the frontend dashboard displays correct volumes for matching
        const [legBvs] = await connection.query(
            `SELECT leg_user_id, SUM(bv_amount - matched_amount) as total_unmatched_bv 
             FROM user_binary_bv_entries 
             WHERE user_id = ? 
             GROUP BY leg_user_id`,
            [parentId]
        );

        let strongestBv = 0.00;
        let weakerSum = 0.00;

        if (legBvs && legBvs.length > 0) {
            // Sort descending by total unmatched BV
            legBvs.sort((a, b) => parseFloat(b.total_unmatched_bv) - parseFloat(a.total_unmatched_bv));
            strongestBv = parseFloat(legBvs[0].total_unmatched_bv) || 0.00;
            for (let i = 1; i < legBvs.length; i++) {
                weakerSum += parseFloat(legBvs[i].total_unmatched_bv) || 0.00;
            }
        }

        await connection.query(
            "UPDATE users SET left_leg_bv = ?, right_leg_bv = ? WHERE id = ?",
            [strongestBv, weakerSum, parentId]
        );
        console.log(`[MLM BV] Cached parent ${parentId} legs: Strongest (Left) = ${strongestBv}, Weaker Sum (Right) = ${weakerSum}`);

        // Move to the next parent
        childId = parentId;
        const [parentRows] = await connection.query("SELECT binary_placement_id FROM users WHERE id = ?", [parentId]);
        if (!parentRows.length) break;

        parentId = parentRows[0].binary_placement_id;
        currentDepth++;
    }
};
