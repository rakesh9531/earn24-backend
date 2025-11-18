// src/Services/mlmConfig.js

// Central configuration for the MLM plan based on your images.
exports.MLM_CONFIG = {
    RANKS: [
        'CUSTOMER', 'DISTRIBUTOR_SILVER', 'DISTRIBUTOR_GOLD', 'DISTRIBUTOR_DIAMOND',
        'LEADER', 'TEAM_LEADER', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR',
        'ASSISTANT_MANAGER', 'MANAGER', 'SR_MANAGER', 'DIRECTOR'
    ],
    PERFORMANCE_BONUS_RATES: {
        'CUSTOMER': 0, 'DISTRIBUTOR_SILVER': 10, 'DISTRIBUTOR_GOLD': 20, 'DISTRIBUTOR_DIAMOND': 30,
        'LEADER': 30, 'TEAM_LEADER': 30, 'ASSISTANT_SUPERVISOR': 30, 'SUPERVISOR': 30,
        'ASSISTANT_MANAGER': 30, 'MANAGER': 30, 'SR_MANAGER': 30, 'DIRECTOR': 30
    },
    ROYALTY_BONUS_RATES: {
        'DISTRIBUTOR_DIAMOND': 6, 'LEADER': 6, 'TEAM_LEADER': 6, 'ASSISTANT_SUPERVISOR': 6,
        'SUPERVISOR': 6, 'ASSISTANT_MANAGER': 6, 'MANAGER': 6, 'SR_MANAGER': 6, 'DIRECTOR': 6
        // Assuming 6% to 2% applies to all ranks from Diamond up. Adjust if needed.
    },
    PROMOTION_CRITERIA: {
        'LEADER': { downline_rank_required: 'DISTRIBUTOR_DIAMOND', count: 2, aggregate_bv_required: 10000 },
        'TEAM_LEADER': { downline_rank_required: 'LEADER', count: 2 },
        'ASSISTANT_SUPERVISOR': { downline_rank_required: 'TEAM_LEADER', count: 2 },
        'SUPERVISOR': { downline_rank_required: 'ASSISTANT_SUPERVISOR', count: 2 },
        'ASSISTANT_MANAGER': { downline_rank_required: 'SUPERVISOR', count: 2 },
        'MANAGER': { downline_rank_required: 'ASSISTANT_MANAGER', count: 2 },
        'SR_MANAGER': { downline_rank_required: 'MANAGER', count: 2, repurchase_bv_12_months_required: 12000 },
        'DIRECTOR': { downline_rank_required: ['MANAGER', 'SR_MANAGER'], count: 14, degree_required: true },
    },
    MONTHLY_QUALIFICATION_RULES: {
        REPURCHASE_BV_REQUIRED: 3000,
        NEW_SPONSORS_ALTERNATIVE_COUNT: 4,
        NEW_SPONSORS_ALTERNATIVE_BV: 500
    },
    FUND_QUALIFICATION_RANKS: {
        LEADERSHIP_FUND: 'LEADER',
        TRAVEL_FUND: 'TEAM_LEADER',
        BIKE_FUND: 'ASSISTANT_SUPERVISOR',
        CAR_FUND: 'SUPERVISOR',
        HOUSE_FUND: 'ASSISTANT_MANAGER'
    }
};