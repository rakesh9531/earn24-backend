// src/Controllers/rewardController.js
const db = require('../../db');
const path = require('path');
const fs = require('fs');

const RANKS = [
    'CUSTOMER', 'DISTRIBUTOR_SILVER', 'DISTRIBUTOR_GOLD', 'DISTRIBUTOR_DIAMOND',
    'LEADER', 'TEAM_LEADER', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR',
    'ASSISTANT_MANAGER', 'MANAGER', 'SR_MANAGER', 'DIRECTOR'
];

// Helper to check rank order
const hasRequiredRank = (userRank, requiredRank) => {
    return RANKS.indexOf(userRank) >= RANKS.indexOf(requiredRank);
};

// Helper: Get current month BV (Self & TGBV)
const getCurrentMonthBV = async (userId, year, month) => {
    // Monthly Personal BV
    const [personalRows] = await db.query(
        `SELECT IFNULL(SUM(bv_earned), 0) as personal_bv 
         FROM user_business_volume 
         WHERE user_id = ? AND bv_type = 'SELF' AND YEAR(transaction_date) = ? AND MONTH(transaction_date) = ?`,
        [userId, year, month]
    );

    // Monthly TGBV (Downline)
    const [tgbvRows] = await db.query(
        `SELECT IFNULL(SUM(bv_earned), 0) as tgbv 
         FROM user_business_volume 
         WHERE user_id = ? AND bv_type = 'DOWNLINE' AND YEAR(transaction_date) = ? AND MONTH(transaction_date) = ?`,
        [userId, year, month]
    );

    return {
        personalBv: parseFloat(personalRows[0].personal_bv || 0),
        tgbv: parseFloat(tgbvRows[0].tgbv || 0)
    };
};

// Helper: Rolling 12-month personal BV (excluding current month)
const getRolling12MonthBV = async (userId) => {
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    const [rows] = await db.query(
        `SELECT IFNULL(SUM(bv_earned), 0) as rolling_bv 
         FROM user_business_volume 
         WHERE user_id = ? AND bv_type = 'SELF' 
           AND transaction_date >= ? AND transaction_date < ?`,
        [userId, twelveMonthsAgo, startOfCurrentMonth]
    );
    return parseFloat(rows[0].rolling_bv || 0);
};

// Helper: Rolling 12-month TGBV
const getRolling12MonthTgbv = async (userId) => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    const [rows] = await db.query(
        `SELECT IFNULL(SUM(bv_earned), 0) as rolling_tgbv 
         FROM user_business_volume 
         WHERE user_id = ? AND bv_type = 'DOWNLINE' 
           AND transaction_date >= ?`,
        [userId, twelveMonthsAgo]
    );
    return parseFloat(rows[0].rolling_tgbv || 0);
};

// Helper: Get recent personal BV including current month
const getRecentMonthsBV = async (userId, monthsCount) => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1);

    const [rows] = await db.query(
        `SELECT IFNULL(SUM(bv_earned), 0) as recent_bv 
         FROM user_business_volume 
         WHERE user_id = ? AND bv_type = 'SELF' 
           AND transaction_date >= ?`,
        [userId, startDate]
    );
    return parseFloat(rows[0].recent_bv || 0);
};

// Helper: Check sponsor activity
const checkSponsorActivity = async (userId) => {
    const [userRows] = await db.query("SELECT sponsor_id FROM users WHERE id = ?", [userId]);
    if (userRows.length === 0 || !userRows[0].sponsor_id) {
        return { active: true, reason: "No sponsor" };
    }
    const sponsorId = userRows[0].sponsor_id;
    const [sponsorRows] = await db.query(
        "SELECT last_purchase_date, username FROM users WHERE id = ?",
        [sponsorId]
    );
    if (sponsorRows.length === 0) {
        return { active: true, reason: "Sponsor not found" };
    }
    const lastPurchase = sponsorRows[0].last_purchase_date;
    if (!lastPurchase) {
        return { active: false, sponsorId, username: sponsorRows[0].username, reason: "Sponsor has no purchase history" };
    }
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    if (new Date(lastPurchase) < sixMonthsAgo) {
        return { active: false, sponsorId, username: sponsorRows[0].username, reason: `Sponsor ${sponsorRows[0].username} has been inactive since ${lastPurchase}` };
    }
    return { active: true, sponsorId, username: sponsorRows[0].username };
};

// Helper: Check sponsor count & BV for Senior Manager Relief Fund
const checkSponsorsForReliefFund = async (userId) => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const [newSponsors] = await db.query(`
        SELECT id, aggregate_personal_bv FROM users 
        WHERE sponsor_id = ? AND created_at >= ? AND is_deleted = 0
    `, [userId, twelveMonthsAgo]);

    // Fast-start = has purchase or is defined by rank
    const fastStartSponsors = newSponsors.filter(s => parseFloat(s.aggregate_personal_bv) >= 3000).length;
    const min500BvSponsors = newSponsors.filter(s => parseFloat(s.aggregate_personal_bv) >= 500).length;

    // Sponsoring target:
    // 2 new sponsors with fast startup, OR
    // 4 new sponsors with minimum 500 BV, OR
    // 1 fast startup + 2 minimum 500 BV.
    const eligibleOption1 = fastStartSponsors >= 2;
    const eligibleOption2 = min500BvSponsors >= 4;
    const eligibleOption3 = fastStartSponsors >= 1 && min500BvSponsors >= 3; // (fast startup itself counts as one >= 500, so we need fast start + 2 other 500+)

    return eligibleOption1 || eligibleOption2 || eligibleOption3;
};

/**
 * USER API: Get User Rewards Dashboard
 */
exports.getUserRewardsDashboard = async (req, res) => {
    const userId = req.user.id;
    try {
        // Fetch user rank, months paid, sponsor info
        const [userRows] = await db.query(
            "SELECT `rank`, bike_fund_months_paid, car_fund_months_paid, house_fund_months_paid, last_12_months_repurchase_bv FROM users WHERE id = ?",
            [userId]
        );
        if (userRows.length === 0) {
            return res.status(404).json({ status: false, message: "User not found." });
        }
        const user = userRows[0];
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const currentMonthKey = year * 100 + month;

        // Fetch monthly BV values
        const { personalBv, tgbv } = await getCurrentMonthBV(userId, year, month);

        // Fetch rolling 12 months self BV
        const rolling12Bv = await getRolling12MonthBV(userId);

        // Fetch sponsor activity check
        const sponsorCheck = await checkSponsorActivity(userId);

        // Fetch existing claims for the current month to set status
        const [existingClaims] = await db.query(
            "SELECT id, reward_type, status, admin_notes, attachment_path, user_details FROM reward_claims WHERE user_id = ? AND claim_month = ?",
            [userId, currentMonthKey]
        );
        const claimsMap = {};
        existingClaims.forEach(c => {
            claimsMap[c.reward_type] = c;
        });

        // 12-month repurchase rule checks
        const isLeaderOrAbove = hasRequiredRank(user.rank, 'LEADER');
        const isTeamLeaderOrAbove = hasRequiredRank(user.rank, 'TEAM_LEADER');

        let passesRolling12Rule = true;
        let rollingRuleReason = "";

        if (isLeaderOrAbove) {
            const requiredRollingBv = isTeamLeaderOrAbove ? 12000 : 3000;
            if (rolling12Bv < requiredRollingBv) {
                // Check 2nd Option
                if (isTeamLeaderOrAbove) {
                    const recent6MonthBv = await getRecentMonthsBV(userId, 6);
                    if (recent6MonthBv < 24000) {
                        passesRolling12Rule = false;
                        rollingRuleReason = `Requires 12,000 personal BV in the last 12 months, or 24,000 personal BV in the last 6 months (Current 12-mo: ${rolling12Bv}, 6-mo: ${recent6MonthBv}).`;
                    }
                } else {
                    const recent3MonthBv = await getRecentMonthsBV(userId, 3);
                    if (recent3MonthBv < 6000) {
                        passesRolling12Rule = false;
                        rollingRuleReason = `Requires 3,000 personal BV in the last 12 months, or 6,000 personal BV in the last 3 months (Current 12-mo: ${rolling12Bv}, 3-mo: ${recent3MonthBv}).`;
                    }
                }
            }
        }

        // Build list of rewards and determine eligibility
        const rewardDefinitions = [
            {
                type: 'LEADERSHIP_FUND',
                name: 'Leadership Fund (2%)',
                requiredRank: 'LEADER',
                targetSelfBv: 1000,
                targetTgbv: 50000,
                isCapped: false
            },
            {
                type: 'TRAVEL_FUND',
                name: 'Travel Fund (2%)',
                requiredRank: 'TEAM_LEADER',
                targetSelfBv: 1000,
                targetTgbv: 75000,
                isCapped: false
            },
            {
                type: 'BIKE_FUND',
                name: 'Bike Fund (₹2,500/mo or 2%)',
                requiredRank: 'ASSISTANT_SUPERVISOR',
                targetSelfBv: 1000,
                targetTgbv: 100000,
                isCapped: true,
                monthsPaidField: 'bike_fund_months_paid',
                maxMonths: 24
            },
            {
                type: 'CAR_FUND',
                name: 'Car Fund (2%)',
                requiredRank: 'SUPERVISOR',
                targetSelfBv: 1000,
                targetTgbv: 200000,
                isCapped: true,
                monthsPaidField: 'car_fund_months_paid',
                maxMonths: 36
            },
            {
                type: 'DOMESTIC_TOUR',
                name: 'Domestic Tour (2D/3N)',
                requiredRank: 'SUPERVISOR',
                isPhysical: true
            },
            {
                type: 'HOUSE_FUND',
                name: 'House Fund (2%)',
                requiredRank: 'ASSISTANT_MANAGER',
                targetSelfBv: 1000,
                targetTgbv: 200000,
                isCapped: true,
                monthsPaidField: 'house_fund_months_paid',
                maxMonths: 60
            },
            {
                type: 'INSURANCE_HEALTH',
                name: 'Health Insurance (up to ₹10 Lakhs)',
                requiredRank: 'MANAGER',
                isPhysical: true
            },
            {
                type: 'INSURANCE_TERM',
                name: 'Term/Life Insurance (up to ₹1 Crore)',
                requiredRank: 'MANAGER',
                isPhysical: true
            },
            {
                type: 'INTERNATIONAL_TOUR',
                name: 'International Tour (2D/3N)',
                requiredRank: 'MANAGER',
                isPhysical: true
            },
            {
                type: 'RELIEF_FUND',
                name: 'Relief Fund (2%)',
                requiredRank: 'SR_MANAGER',
                isAnnual: true
            }
        ];

        const rewardsData = [];

        for (const def of rewardDefinitions) {
            const hasRank = hasRequiredRank(user.rank, def.requiredRank);
            let isEligible = hasRank;
            let eligibilityReason = "";

            if (!hasRank) {
                isEligible = false;
                eligibilityReason = `Requires rank ${def.requiredRank} or above. Current rank: ${user.rank}`;
            } else if (!sponsorCheck.active) {
                isEligible = false;
                eligibilityReason = `Blocked: ${sponsorCheck.reason}`;
            } else if (!passesRolling12Rule) {
                isEligible = false;
                eligibilityReason = `Blocked by 12-month activity rule: ${rollingRuleReason}`;
            } else if (def.isCapped) {
                const monthsPaid = user[def.monthsPaidField] || 0;
                if (monthsPaid >= def.maxMonths) {
                    isEligible = false;
                    eligibilityReason = `Capped: Maximum limit of ${def.maxMonths} months reached.`;
                } else {
                    // Check monthly thresholds
                    if (personalBv < def.targetSelfBv || tgbv < def.targetTgbv) {
                        isEligible = false;
                        eligibilityReason = `Current Month targets not met. Required: Personal BV >= ${def.targetSelfBv}, TGBV >= ${def.targetTgbv}. (Current: Personal: ${personalBv}, TGBV: ${tgbv}).`;
                    }
                }
            } else if (def.targetSelfBv && def.targetTgbv) {
                if (personalBv < def.targetSelfBv || tgbv < def.targetTgbv) {
                    isEligible = false;
                    eligibilityReason = `Current Month targets not met. Required: Personal BV >= ${def.targetSelfBv}, TGBV >= ${def.targetTgbv}. (Current: Personal: ${personalBv}, TGBV: ${tgbv}).`;
                }
            } else if (def.isAnnual && def.type === 'RELIEF_FUND') {
                // Senior Manager Relief Fund annual qualification checks
                const rolling12Tgbv = await getRolling12MonthTgbv(userId);
                const hasSponsorTargets = await checkSponsorsForReliefFund(userId);
                if (rolling12Bv < 12000 || rolling12Tgbv < 5000000 || !hasSponsorTargets) {
                    isEligible = false;
                    eligibilityReason = `Annual targets not met. Requires: rolling 12-month Personal BV >= 12,000 (Current: ${rolling12Bv}), TGBV >= 50,00,000 (Current: ${rolling12Tgbv}), and sponsoring targets.`;
                }
            }

            const existing = claimsMap[def.type];
            let claimStatus = 'NOT_ELIGIBLE';
            if (existing) {
                claimStatus = existing.status;
            } else if (isEligible) {
                claimStatus = 'CLAIMABLE';
            }

            rewardsData.push({
                type: def.type,
                name: def.name,
                isEligible,
                eligibilityReason: eligibilityReason || "Eligible to claim.",
                status: claimStatus,
                monthsPaid: def.isCapped ? user[def.monthsPaidField] || 0 : undefined,
                maxMonths: def.isCapped ? def.maxMonths : undefined,
                claimId: existing ? existing.id : null,
                adminNotes: existing ? existing.admin_notes : null,
                attachmentPath: existing ? existing.attachment_path : null,
                userDetails: existing ? existing.user_details : null,
                currentPersonalBv: personalBv,
                targetPersonalBv: def.targetSelfBv || 0,
                currentTgbv: tgbv,
                targetTgbv: def.targetTgbv || 0
            });
        }

        res.status(200).json({
            status: true,
            data: {
                userRank: user.rank,
                currentMonth: currentMonthKey,
                personalBv,
                tgbv,
                rolling12Bv,
                sponsorActive: sponsorCheck.active,
                rewards: rewardsData
            }
        });
    } catch (e) {
        console.error("Dashboard error:", e);
        res.status(500).json({ status: false, message: e.message });
    }
};

/**
 * USER API: Submit/Update Claim Request
 */
exports.submitClaim = async (req, res) => {
    const userId = req.user.id;
    const { rewardType, userDetails } = req.body;

    if (!rewardType) {
        return res.status(400).json({ status: false, message: "Reward type is required." });
    }

    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const currentMonthKey = year * 100 + month;

        // Check if there is already a claim for this month
        const [existing] = await db.query(
            "SELECT * FROM reward_claims WHERE user_id = ? AND reward_type = ? AND claim_month = ?",
            [userId, rewardType, currentMonthKey]
        );

        if (existing.length > 0) {
            const claim = existing[0];
            if (claim.status === 'APPROVED') {
                return res.status(400).json({ status: false, message: "This reward has already been approved for the current month." });
            }
            // Update user details for pending or rejected claims
            await db.query(
                "UPDATE reward_claims SET user_details = ?, status = 'PENDING', updated_at = NOW() WHERE id = ?",
                [JSON.stringify(userDetails || {}), claim.id]
            );
            return res.status(200).json({ status: true, message: "Claim request details updated successfully.", claimId: claim.id });
        }

        // Verify eligibility before creating a new claim
        const [userRows] = await db.query("SELECT `rank` FROM users WHERE id = ?", [userId]);
        if (userRows.length === 0) {
            return res.status(404).json({ status: false, message: "User not found." });
        }
        const user = userRows[0];

        const rewardDefinitions = {
            'LEADERSHIP_FUND': { requiredRank: 'LEADER' },
            'TRAVEL_FUND': { requiredRank: 'TEAM_LEADER' },
            'BIKE_FUND': { requiredRank: 'ASSISTANT_SUPERVISOR' },
            'CAR_FUND': { requiredRank: 'SUPERVISOR' },
            'DOMESTIC_TOUR': { requiredRank: 'SUPERVISOR' },
            'HOUSE_FUND': { requiredRank: 'ASSISTANT_MANAGER' },
            'INSURANCE_HEALTH': { requiredRank: 'MANAGER' },
            'INSURANCE_TERM': { requiredRank: 'MANAGER' },
            'INTERNATIONAL_TOUR': { requiredRank: 'MANAGER' },
            'RELIEF_FUND': { requiredRank: 'SR_MANAGER' }
        };

        const def = rewardDefinitions[rewardType];
        if (!def) {
            return res.status(400).json({ status: false, message: "Invalid reward type." });
        }

        if (!hasRequiredRank(user.rank, def.requiredRank)) {
            return res.status(403).json({ status: false, message: `Your rank must be ${def.requiredRank} or above to claim this reward.` });
        }

        // Create new claim
        const [insertResult] = await db.query(
            `INSERT INTO reward_claims (user_id, reward_type, claim_month, status, user_details) 
             VALUES (?, ?, ?, 'PENDING', ?)`,
            [userId, rewardType, currentMonthKey, JSON.stringify(userDetails || {})]
        );

        res.status(200).json({
            status: true,
            message: "Claim request submitted successfully.",
            claimId: insertResult.insertId
        });
    } catch (e) {
        console.error("Submit claim error:", e);
        res.status(500).json({ status: false, message: e.message });
    }
};

/**
 * USER API: Get Claim History/Inbox
 */
exports.getClaimHistory = async (req, res) => {
    const userId = req.user.id;
    try {
        const [rows] = await db.query(
            "SELECT * FROM reward_claims WHERE user_id = ? ORDER BY created_at DESC",
            [userId]
        );
        res.status(200).json({ status: true, data: rows });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

/**
 * ADMIN API: Get All Claims
 */
exports.adminGetClaims = async (req, res) => {
    const { status, type } = req.query;
    let query = `
        SELECT c.*, u.username, u.full_name, u.rank, u.mobile_number 
        FROM reward_claims c 
        JOIN users u ON c.user_id = u.id 
    `;
    const params = [];
    const conditions = [];

    if (status) {
        conditions.push("c.status = ?");
        params.push(status);
    }
    if (type) {
        conditions.push("c.reward_type = ?");
        params.push(type);
    }

    if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
    }
    query += " ORDER BY c.created_at DESC";

    try {
        const [rows] = await db.query(query, params);
        res.status(200).json({ status: true, data: rows });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};

/**
 * ADMIN API: Respond to Claim (Approve/Reject)
 */
exports.adminRespondToClaim = async (req, res) => {
    const { claimId, status, adminNotes } = req.body;
    let attachmentPath = null;

    if (req.file) {
        // Map relative path for web access
        attachmentPath = `src/uploads/rewards/${req.file.filename}`;
    }

    if (!claimId || !status) {
        return res.status(400).json({ status: false, message: "Claim ID and status are required." });
    }

    if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ status: false, message: "Status must be APPROVED or REJECTED." });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get Claim details
        const [claimRows] = await connection.query(
            "SELECT * FROM reward_claims WHERE id = ? FOR UPDATE",
            [claimId]
        );
        if (claimRows.length === 0) {
            connection.release();
            return res.status(404).json({ status: false, message: "Claim not found." });
        }
        const claim = claimRows[0];

        if (claim.status !== 'PENDING') {
            connection.release();
            return res.status(400).json({ status: false, message: `Claim is already processed with status: ${claim.status}` });
        }

        // Parse user details
        const details = typeof claim.user_details === 'string' ? JSON.parse(claim.user_details) : (claim.user_details || {});

        if (status === 'APPROVED') {
            const isMonthlyFund = [
                'BIKE_FUND', 'CAR_FUND', 'HOUSE_FUND', 'LEADERSHIP_FUND', 'TRAVEL_FUND', 'RELIEF_FUND'
            ].includes(claim.reward_type);

            if (isMonthlyFund) {
                // Determine payout amount. For pool payouts, the monthly distribution script will have stored the amount.
                // If not available (e.g. manual claim), use a default or verify if we need override details.
                let amount = parseFloat(details.payout_amount || 0);

                // For Bike Fund, fallback to 2500 minimum if not set
                if (claim.reward_type === 'BIKE_FUND' && amount < 2500) {
                    amount = 2500;
                }

                if (amount <= 0) {
                    // Fail if there is no positive payout amount for cash claims
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({ status: false, message: "Payout amount is 0. Cannot approve a cash fund without a payout amount." });
                }

                // 2. Add to user's wallet
                await connection.query(
                    "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
                    [amount, claim.user_id]
                );

                // 3. Write transaction log
                await connection.query(
                    `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks) 
                     VALUES (?, 'credit', ?, 'manual', ?, ?)`,
                    [claim.user_id, amount, `REWARD_${claim.id}`, `Approved payout for ${claim.reward_type}`]
                );

                // 4. Record to unified commission ledger (to match legacy MLM tracking)
                await connection.query(
                    `INSERT INTO commission_ledger (user_id, source_user_id, source_order_id, commission_type, base_bv, percentage_applied, amount_credited, notes) 
                     VALUES (?, NULL, NULL, ?, 0, 0, ?, ?)`,
                    [claim.user_id, claim.reward_type, amount, `Approved Reward Payout: ${claim.reward_type}`]
                );

                // 5. Increment paid months count
                if (claim.reward_type === 'BIKE_FUND') {
                    await connection.query("UPDATE users SET bike_fund_months_paid = bike_fund_months_paid + 1 WHERE id = ?", [claim.user_id]);
                } else if (claim.reward_type === 'CAR_FUND') {
                    await connection.query("UPDATE users SET car_fund_months_paid = car_fund_months_paid + 1 WHERE id = ?", [claim.user_id]);
                } else if (claim.reward_type === 'HOUSE_FUND') {
                    await connection.query("UPDATE users SET house_fund_months_paid = house_fund_months_paid + 1 WHERE id = ?", [claim.user_id]);
                }
            }
        }

        // 6. Update Claim record
        await connection.query(
            "UPDATE reward_claims SET status = ?, admin_notes = ?, attachment_path = IFNULL(?, attachment_path), updated_at = NOW() WHERE id = ?",
            [status, adminNotes || null, attachmentPath, claimId]
        );

        await connection.commit();
        connection.release();

        res.status(200).json({
            status: true,
            message: `Claim request has been successfully ${status.toLowerCase()}${status === 'APPROVED' ? ' and payout has been credited to wallet' : ''}.`
        });
    } catch (e) {
        await connection.rollback();
        connection.release();
        console.error("Admin response error:", e);
        res.status(500).json({ status: false, message: e.message });
    }
};

/**
 * ADMIN API: Manual Override (Force qualify or payout)
 */
exports.adminManualOverride = async (req, res) => {
    const { userId, rewardType, payoutAmount, claimMonth, adminNotes } = req.body;

    if (!userId || !rewardType || !claimMonth) {
        return res.status(400).json({ status: false, message: "User ID, Reward Type, and Claim Month are required." });
    }

    try {
        // Create manual claim in PENDING state or directly in APPROVED state if requested
        const details = {
            payout_amount: payoutAmount || 0,
            is_manual_override: true,
            override_by: req.user.username || 'admin'
        };

        const [insertResult] = await db.query(
            `INSERT INTO reward_claims (user_id, reward_type, claim_month, status, user_details, admin_notes) 
             VALUES (?, ?, ?, 'PENDING', ?, ?)`,
            [userId, rewardType, claimMonth, JSON.stringify(details), adminNotes || "Manual Override"]
        );

        res.status(200).json({
            status: true,
            message: "Manual claim request created successfully as PENDING. You can now approve it to credit the user.",
            claimId: insertResult.insertId
        });
    } catch (e) {
        res.status(500).json({ status: false, message: e.message });
    }
};
