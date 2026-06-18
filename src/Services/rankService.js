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

// Helper to recursively calculate the total group BV of a user's downline tree (including themselves)
async function calculateSubtreeBv(userId) {
    let totalBv = 0;
    let currentLevelIds = [userId];

    while (currentLevelIds.length > 0) {
        const [levelUsers] = await db.query('SELECT id, aggregate_personal_bv FROM users WHERE id IN (?)', [currentLevelIds]);
        for (const u of levelUsers) {
            totalBv += parseFloat(u.aggregate_personal_bv) || 0;
        }

        const [downlines] = await db.query('SELECT id FROM users WHERE sponsor_id IN (?) AND is_deleted = 0', [currentLevelIds]);
        currentLevelIds = downlines.map(d => d.id);
    }
    return totalBv;
}

// Helper to verify other legs BV condition:
// 1. Identify all direct downlines sponsored by the user.
// 2. Compute the subtree BV for each direct downline leg.
// 3. Exclude the top 2 legs that hold the required minimum rank.
// 4. Check if the sum of BV in all other legs is >= target.
async function checkOtherLegsBv(userId, requiredRank, otherLegsBvTarget) {
    const [directDownlines] = await db.query(
        'SELECT id, `rank` FROM users WHERE sponsor_id = ? AND is_deleted = 0',
        [userId]
    );
    if (directDownlines.length === 0) return false;

    const legs = [];
    for (const dl of directDownlines) {
        const legBv = await calculateSubtreeBv(dl.id);
        legs.push({
            id: dl.id,
            rank: dl.rank,
            bv: legBv
        });
    }

    const requiredRankIdx = MLM_CONFIG.RANKS.indexOf(requiredRank);
    const qualifyingLegs = legs.filter(l => {
        const rankIdx = MLM_CONFIG.RANKS.indexOf(l.rank);
        return rankIdx >= requiredRankIdx;
    });

    if (qualifyingLegs.length < 2) return false;

    qualifyingLegs.sort((a, b) => b.bv - a.bv);
    const excludedLegIds = [qualifyingLegs[0].id, qualifyingLegs[1].id];

    let otherLegsBvSum = 0;
    for (const leg of legs) {
        if (!excludedLegIds.includes(leg.id)) {
            otherLegsBvSum += leg.bv;
        }
    }

    console.log(`[MLM Leg Check] User ${userId}: other legs BV sum = ${otherLegsBvSum} (Target: ${otherLegsBvTarget})`);
    return otherLegsBvSum >= otherLegsBvTarget;
}

// Helper to verify Rule h sponsoring requirement
async function checkRuleHQualification(userId, afterDate, connection = db) {
    const [sponsors] = await connection.query(`
        SELECT 
            u.id, 
            u.created_at, 
            u.last_purchase_date,
            IFNULL(
                (SELECT SUM(bv_earned) 
                 FROM user_business_volume 
                 WHERE user_id = u.id 
                   AND bv_type = 'SELF' 
                   AND transaction_date >= DATE_FORMAT(u.created_at, '%Y-%m-01 00:00:00')
                   AND transaction_date < DATE_ADD(LAST_DAY(u.created_at), INTERVAL 1 DAY)
                ), 0
            ) as starting_bv
        FROM users u
        WHERE u.sponsor_id = ? 
          AND u.created_at >= ?
          AND u.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
          AND u.is_deleted = 0
    `, [userId, afterDate]);

    if (sponsors.length === 0) return false;

    // Group sponsors by registration month
    const sponsorsByMonth = {};
    for (const sp of sponsors) {
        const dateObj = new Date(sp.created_at);
        const yearMonth = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        if (!sponsorsByMonth[yearMonth]) {
            sponsorsByMonth[yearMonth] = [];
        }
        sponsorsByMonth[yearMonth].push({
            id: sp.id,
            starting_bv: parseFloat(sp.starting_bv) || 0,
            last_purchase_date: sp.last_purchase_date
        });
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const isSponsorActive = (sp) => {
        if (!sp.last_purchase_date) return false;
        return new Date(sp.last_purchase_date) >= sixMonthsAgo;
    };

    // Find all active sponsors across all months that can act as replacements
    const allActiveSponsors = sponsors.filter(isSponsorActive).map(sp => ({
        id: sp.id,
        starting_bv: parseFloat(sp.starting_bv) || 0,
        created_at: sp.created_at
    }));

    // Helper to try and qualify a month using its sponsors and available replacements
    const canQualifyMonth = (monthStr, monthSponsors) => {
        // Option 1 original candidate: 2 sponsors with >= 1000 BV in this month
        const opt1Candidates = monthSponsors.filter(s => s.starting_bv >= 1000);
        if (opt1Candidates.length >= 2) {
            const activeInMonth = opt1Candidates.filter(isSponsorActive);
            const neededReplacements = 2 - activeInMonth.length;
            if (neededReplacements <= 0) return true;

            const activeReplacements = allActiveSponsors.filter(r => {
                const rDate = new Date(r.created_at);
                const rMonthStr = `${rDate.getFullYear()}-${String(rDate.getMonth() + 1).padStart(2, '0')}`;
                return rMonthStr !== monthStr && r.starting_bv >= 1000;
            });
            if (activeReplacements.length >= neededReplacements) return true;
        }

        // Option 2 original candidate: 4 sponsors with >= 500 BV in this month
        const opt2Candidates = monthSponsors.filter(s => s.starting_bv >= 500);
        if (opt2Candidates.length >= 4) {
            const activeInMonth = opt2Candidates.filter(isSponsorActive);
            const neededReplacements = 4 - activeInMonth.length;
            if (neededReplacements <= 0) return true;

            const activeReplacements = allActiveSponsors.filter(r => {
                const rDate = new Date(r.created_at);
                const rMonthStr = `${rDate.getFullYear()}-${String(rDate.getMonth() + 1).padStart(2, '0')}`;
                return rMonthStr !== monthStr && r.starting_bv >= 500;
            });
            if (activeReplacements.length >= neededReplacements) return true;
        }

        // Option 3 original candidate: 1 sponsor with >= 1000 BV and 2 other sponsors with >= 500 BV in this month
        const opt3Candidates1000 = monthSponsors.filter(s => s.starting_bv >= 1000);
        const opt3Candidates500 = monthSponsors.filter(s => s.starting_bv >= 500);
        if (opt3Candidates1000.length >= 1 && opt3Candidates500.length >= 3) {
            for (const s1000 of opt3Candidates1000) {
                const others500 = opt3Candidates500.filter(s => s.id !== s1000.id);
                if (others500.length >= 2) {
                    const slot1Active = isSponsorActive(s1000);
                    
                    for (let i = 0; i < others500.length; i++) {
                        for (let j = i + 1; j < others500.length; j++) {
                            const s500_1 = others500[i];
                            const s500_2 = others500[j];

                            const slot2Active = isSponsorActive(s500_1);
                            const slot3Active = isSponsorActive(s500_2);

                            let activeInMonthCount = (slot1Active ? 1 : 0) + (slot2Active ? 1 : 0) + (slot3Active ? 1 : 0);
                            if (activeInMonthCount === 3) return true;

                            const neededReplacements = 3 - activeInMonthCount;
                            const inactiveSlots = [];
                            if (!slot1Active) inactiveSlots.push(1000);
                            if (!slot2Active) inactiveSlots.push(500);
                            if (!slot3Active) inactiveSlots.push(500);

                            const otherMonthReplacements = allActiveSponsors.filter(r => {
                                const rDate = new Date(r.created_at);
                                const rMonthStr = `${rDate.getFullYear()}-${String(rDate.getMonth() + 1).padStart(2, '0')}`;
                                return rMonthStr !== monthStr;
                            });

                            inactiveSlots.sort((a, b) => b - a);
                            const availableRepls = [...otherMonthReplacements].sort((a, b) => b.starting_bv - a.starting_bv);

                            let matchCount = 0;
                            for (const slotMinBv of inactiveSlots) {
                                const foundIndex = availableRepls.findIndex(r => r.starting_bv >= slotMinBv);
                                if (foundIndex !== -1) {
                                    matchCount++;
                                    availableRepls.splice(foundIndex, 1);
                                }
                            }

                            if (matchCount === inactiveSlots.length) {
                                return true;
                            }
                        }
                    }
                }
            }
        }

        return false;
    };

    for (const monthStr of Object.keys(sponsorsByMonth)) {
        if (canQualifyMonth(monthStr, sponsorsByMonth[monthStr])) {
            return true;
        }
    }

    return false;
}

exports.checkRuleHQualification = checkRuleHQualification;

exports.checkAndPromoteUser = async (userId) => {
    const [users] = await db.query('SELECT id, sponsor_id, `rank`, aggregate_personal_bv, last_12_months_repurchase_bv FROM users WHERE id = ?', [userId]);
    if (!users.length) return;
    const user = users[0];

    const nextRank = getNextRank(user.rank);
    if (!nextRank || !MLM_CONFIG.PROMOTION_CRITERIA[nextRank]) {
        if (user.sponsor_id) {
            await exports.checkAndPromoteUser(user.sponsor_id);
        }
        return;
    }

    const criteria = MLM_CONFIG.PROMOTION_CRITERIA[nextRank];
    let isQualified = true;

    // 1. Check downline rank requirements
    if (nextRank === 'DIRECTOR') {
        const [directDownlines] = await db.query(
            "SELECT id, `rank`, last_purchase_date FROM users WHERE sponsor_id = ? AND is_deleted = 0",
            [userId]
        );

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const activeManagers = directDownlines.filter(dl => {
            const hasPurchase = dl.last_purchase_date && new Date(dl.last_purchase_date) >= sixMonthsAgo;
            const hasRank = ['MANAGER', 'SR_MANAGER', 'DIRECTOR'].includes(dl.rank);
            return hasPurchase && hasRank;
        });

        if (activeManagers.length < criteria.count) {
            isQualified = false;
        } else {
            const srManagersCount = activeManagers.filter(dl => ['SR_MANAGER', 'DIRECTOR'].includes(dl.rank)).length;
            if (srManagersCount < criteria.required_sr_managers_count) {
                isQualified = false;
            }
        }
    } else if (criteria.downline_rank_required) {
        const requiredRanks = Array.isArray(criteria.downline_rank_required)
            ? criteria.downline_rank_required
            : [criteria.downline_rank_required];
        
        let minIndex = MLM_CONFIG.RANKS.length;
        for (const reqRank of requiredRanks) {
            const idx = MLM_CONFIG.RANKS.indexOf(reqRank);
            if (idx !== -1 && idx < minIndex) {
                minIndex = idx;
            }
        }
        
        const allowedRanks = MLM_CONFIG.RANKS.slice(minIndex);

        const [downline] = await db.query(
            'SELECT COUNT(id) as count FROM users WHERE sponsor_id = ? AND `rank` IN (?)',
            [userId, allowedRanks]
        );
        if (downline[0].count < criteria.count) {
            isQualified = false;
        }
    } else {
        const [downline] = await db.query(
            'SELECT COUNT(id) as count FROM users WHERE sponsor_id = ?',
            [userId]
        );
        if (downline[0].count < criteria.count) {
            isQualified = false;
        }
    }

    // 2. Check Self Repurchase BV Requirements (till date aggregate, e.g. for Leader)
    if (isQualified && criteria.self_bv_required) {
        if (parseFloat(user.aggregate_personal_bv || 0) < criteria.self_bv_required) {
            isQualified = false;
        }
    }

    // 3. Check Group BV requirements (Apna purchase + Downline purchase)
    if (isQualified && criteria.aggregate_bv_required) {
        const totalGroupBv = await calculateSubtreeBv(userId);
        if (totalGroupBv < criteria.aggregate_bv_required) {
            isQualified = false;
        }
    }

    // 4. Check Other Legs BV Requirements (e.g. for Assistant Supervisor & Sr. Manager)
    if (isQualified && criteria.other_legs_bv_required) {
        const requiredRank = criteria.downline_rank_required;
        const otherLegsQualified = await checkOtherLegsBv(userId, requiredRank, criteria.other_legs_bv_required);
        if (!otherLegsQualified) {
            isQualified = false;
        }
    }

    // 5. Check rolling 12-month repurchase requirement
    if (isQualified && criteria.repurchase_bv_12_months_required && user.last_12_months_repurchase_bv < criteria.repurchase_bv_12_months_required) {
        isQualified = false;
    }

    // 6. Check Rule h Sponsoring T&C for Leader up to Manager
    const ruleHRanks = ['LEADER', 'TEAM_LEADER', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'ASSISTANT_MANAGER', 'MANAGER'];
    if (isQualified && ruleHRanks.includes(nextRank)) {
        const afterDate = user.last_rank_promoted_at || user.created_at;
        const ruleHPassed = await checkRuleHQualification(userId, afterDate, db);
        if (!ruleHPassed) {
            isQualified = false;
        }
    }

    // --- QUALIFIED FOR PROMOTION! ---
    if (isQualified) {
        await db.query('UPDATE users SET `rank` = ?, last_rank_promoted_at = NOW() WHERE id = ?', [nextRank, userId]);
        console.log(`[MLM] User ${userId} has been PROMOTED to ${nextRank}!`);
    }

    // Always bubble up the check to the sponsor
    if (user.sponsor_id) {
        await exports.checkAndPromoteUser(user.sponsor_id);
    }
};