// src/Services/rankService.js
const db = require('../../db');
const { MLM_CONFIG } = require('./mlmConfig');

function getNextRank(currentRank) {
    const currentIndex = MLM_CONFIG.RANKS.indexOf(currentRank);
    if (currentIndex >= 0 && currentIndex < MLM_CONFIG.RANKS.length - 1) {
        return MLM_CONFIG.RANKS[currentIndex + 1];
    }
    return null;
}

exports.checkAndPromoteUser = async (userId) => {
    const [users] = await db.query('SELECT id, sponsor_id, rank, aggregate_personal_bv, last_12_months_repurchase_bv, has_graduation_degree FROM users WHERE id = ?', [userId]);
    if (!users.length) return;
    const user = users[0];

    const nextRank = getNextRank(user.rank);
    if (!nextRank || !MLM_CONFIG.PROMOTION_CRITERIA[nextRank]) return;

    const criteria = MLM_CONFIG.PROMOTION_CRITERIA[nextRank];

    // Check downline rank requirement
    const [downline] = await db.query(
        'SELECT COUNT(id) as count FROM users WHERE sponsor_id = ? AND rank IN (?)',
        [userId, criteria.downline_rank_required]
    );
    if (downline[0].count < criteria.count) return;

    // Check BV requirements
    if (criteria.aggregate_bv_required && user.aggregate_personal_bv < criteria.aggregate_bv_required) return;
    if (criteria.repurchase_bv_12_months_required && user.last_12_months_repurchase_bv < criteria.repurchase_bv_12_months_required) return;

    // Check special requirements
    if (criteria.degree_required && !user.has_graduation_degree) return;

    // --- QUALIFIED! ---
    await db.query('UPDATE users SET rank = ? WHERE id = ?', [nextRank, userId]);
    console.log(`[MLM] User ${userId} has been PROMOTED to ${nextRank}!`);

    if (user.sponsor_id) {
        await exports.checkAndPromoteUser(user.sponsor_id);
    }
};