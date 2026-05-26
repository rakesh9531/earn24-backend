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
    // Wrapped 'rank' in backticks because it is a reserved keyword in some MySQL versions
    const [users] = await db.query('SELECT id, sponsor_id, `rank`, aggregate_personal_bv, last_12_months_repurchase_bv, has_graduation_degree FROM users WHERE id = ?', [userId]);
    if (!users.length) return;
    const user = users[0];

    const nextRank = getNextRank(user.rank);
    if (!nextRank || !MLM_CONFIG.PROMOTION_CRITERIA[nextRank]) {
        // If there's no next rank, still bubble up to the sponsor
        if (user.sponsor_id) {
            await exports.checkAndPromoteUser(user.sponsor_id);
        }
        return;
    }

    const criteria = MLM_CONFIG.PROMOTION_CRITERIA[nextRank];

    // Check downline rank requirement
    let downlineCount = 0;
    if (criteria.downline_rank_required) {
        const [downline] = await db.query(
            'SELECT COUNT(id) as count FROM users WHERE sponsor_id = ? AND `rank` IN (?)',
            [userId, criteria.downline_rank_required]
        );
        downlineCount = downline[0].count;
    } else {
        const [downline] = await db.query(
            'SELECT COUNT(id) as count FROM users WHERE sponsor_id = ?',
            [userId]
        );
        downlineCount = downline[0].count;
    }
    
    let isQualified = true;
    
    if (downlineCount < criteria.count) isQualified = false;

    // Check BV requirements (Group BV = Apna purchase + Downline purchase)
    if (isQualified && criteria.aggregate_bv_required) {
        let totalGroupBv = 0;
        let currentLevelIds = [userId];

        while (currentLevelIds.length > 0) {
            const [levelUsers] = await db.query('SELECT id, aggregate_personal_bv FROM users WHERE id IN (?)', [currentLevelIds]);
            for (const u of levelUsers) {
                totalGroupBv += parseFloat(u.aggregate_personal_bv) || 0;
            }

            const [downlines] = await db.query('SELECT id FROM users WHERE sponsor_id IN (?)', [currentLevelIds]);
            currentLevelIds = downlines.map(d => d.id);
        }

        if (totalGroupBv < criteria.aggregate_bv_required) isQualified = false;
    }
    if (isQualified && criteria.repurchase_bv_12_months_required && user.last_12_months_repurchase_bv < criteria.repurchase_bv_12_months_required) isQualified = false;

    // Check special requirements
    if (isQualified && criteria.degree_required && !user.has_graduation_degree) isQualified = false;

    // --- QUALIFIED! ---
    if (isQualified) {
        await db.query('UPDATE users SET `rank` = ? WHERE id = ?', [nextRank, userId]);
        console.log(`[MLM] User ${userId} has been PROMOTED to ${nextRank}!`);
    }

    // Always bubble up the check to the sponsor (since downline changes/BV changes affect the whole upline)
    if (user.sponsor_id) {
        await exports.checkAndPromoteUser(user.sponsor_id);
    }
};