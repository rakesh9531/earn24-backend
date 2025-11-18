const db = require('../../db'); // Adjust path if necessary

/**
 * Validates and sanitizes pagination and sorting parameters from the request query.
 * @param {object} query - The request query object (req.query).
 * @param {string[]} allowedSortColumns - An array of column names that are safe to sort by.
 * @returns {object} - An object containing sanitized page, limit, offset, search, sortBy, and sortOrder.
 */
const getSanitizedQueryParams = (query, allowedSortColumns) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 10)); // Cap limit at 100
    const offset = (page - 1) * limit;
    const search = query.search || '';
    const searchPattern = `%${search}%`;

    // Whitelist sorting to prevent SQL injection
    const sortBy = allowedSortColumns.includes(query.sortBy) ? query.sortBy : 'transaction_date';
    const sortOrder = (query.sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    return { page, limit, offset, search, searchPattern, sortBy, sortOrder };
};


/**
 * Fetches the profit distribution ledger for the admin panel.
 * Includes robust validation, sorting, pagination, and search.
 */
exports.getProfitLedger = async (req, res) => {
    try {
        const allowedSortColumns = ['transaction_date', 'full_name', 'amount_credited', 'distribution_type'];
        const { page, limit, offset, search, searchPattern, sortBy, sortOrder } = getSanitizedQueryParams(req.query, allowedSortColumns);

        // This query joins the ledger with the users table to get the user's name
        // We use ?? for identifiers (like column names) and ? for values to prevent SQL injection.
        const dataQuery = `
            SELECT 
                l.id,
                l.order_item_id,
                l.user_id,
                l.distribution_type,
                l.total_profit_on_item,
                l.distributable_amount,
                l.percentage_applied,
                l.amount_credited,
                l.transaction_date,
                u.full_name, 
                u.email
            FROM profit_distribution_ledger l
            JOIN users u ON l.user_id = u.id
            WHERE 
                (u.full_name LIKE ? OR u.email LIKE ? OR l.distribution_type LIKE ?)
            ORDER BY ?? ${sortOrder}
            LIMIT ? OFFSET ?;
        `;
        const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, searchPattern, sortBy, limit, offset]);

        const countQuery = `
            SELECT COUNT(l.id) as total
            FROM profit_distribution_ledger l
            JOIN users u ON l.user_id = u.id
            WHERE 
                (u.full_name LIKE ? OR u.email LIKE ? OR l.distribution_type LIKE ?);
        `;
        const [countRows] = await db.query(countQuery, [searchPattern, searchPattern, searchPattern]);
        const totalRecords = countRows[0].total;

        res.status(200).json({
            status: true,
            data: rows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords,
                limit: limit
            }
        });

    } catch (error) {
        console.error("Error fetching profit ledger:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching the profit ledger." });
    }
};

/**
 * Fetches the user business volume (BV) ledger for the admin panel.
 * Includes robust validation, sorting, pagination, and search.
 */
exports.getBvLedger = async (req, res) => {
    try {
        const allowedSortColumns = ['transaction_date', 'full_name', 'bv_earned', 'product_name'];
        const { page, limit, offset, search, searchPattern, sortBy, sortOrder } = getSanitizedQueryParams(req.query, allowedSortColumns);

        // This query joins the BV ledger with users and products tables
        const dataQuery = `
            SELECT 
                bv.id,
                bv.user_id,
                bv.order_item_id,
                bv.product_id,
                bv.net_profit_base,
                bv.bv_earned,
                bv.transaction_date,
                bv.notes,
                u.full_name,
                p.name as product_name
            FROM user_business_volume bv
            JOIN users u ON bv.user_id = u.id
            LEFT JOIN products p ON bv.product_id = p.id
            WHERE 
                (u.full_name LIKE ? OR u.email LIKE ? OR p.name LIKE ?)
            ORDER BY ?? ${sortOrder}
            LIMIT ? OFFSET ?;
        `;
        const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, searchPattern, sortBy, limit, offset]);

        const countQuery = `
            SELECT COUNT(bv.id) as total
            FROM user_business_volume bv
            JOIN users u ON bv.user_id = u.id
            LEFT JOIN products p ON bv.product_id = p.id
            WHERE 
                (u.full_name LIKE ? OR u.email LIKE ? OR p.name LIKE ?);
        `;
        const [countRows] = await db.query(countQuery, [searchPattern, searchPattern, searchPattern]);
        const totalRecords = countRows[0].total;

        res.status(200).json({
            status: true,
            data: rows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords,
                limit: limit
            }
        });

    } catch (error) {
        console.error("Error fetching BV ledger:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching the BV ledger." });
    }
};


// MLM system 

// --- NEW UNIFIED FUNCTION TO GET ALL COMMISSIONS ---
exports.getCommissionLedger = async (req, res) => {
    try {
        const allowedSortColumns = ['transaction_date', 'full_name', 'amount_credited', 'commission_type', 'source_full_name'];
        const { page, limit, offset, search, searchPattern, sortBy, sortOrder } = getSanitizedQueryParams(req.query, allowedSortColumns);

        const dataQuery = `
            SELECT 
                l.id, l.user_id, l.source_user_id, l.source_order_id,
                l.commission_type, l.base_bv, l.percentage_applied, l.amount_credited, l.transaction_date,
                u.full_name,
                source_user.full_name as source_full_name
            FROM commission_ledger l
            JOIN users u ON l.user_id = u.id
            LEFT JOIN users source_user ON l.source_user_id = source_user.id
            WHERE (u.full_name LIKE ? OR l.commission_type LIKE ? OR source_user.full_name LIKE ?)
            ORDER BY ?? ${sortOrder}
            LIMIT ? OFFSET ?;
        `;
        const [rows] = await db.query(dataQuery, [searchPattern, searchPattern, searchPattern, sortBy, limit, offset]);

        const countQuery = `
            SELECT COUNT(l.id) as total FROM commission_ledger l
            JOIN users u ON l.user_id = u.id
            LEFT JOIN users source_user ON l.source_user_id = source_user.id
            WHERE (u.full_name LIKE ? OR l.commission_type LIKE ? OR source_user.full_name LIKE ?);
        `;
        const [countRows] = await db.query(countQuery, [searchPattern, searchPattern, searchPattern]);
        
        res.status(200).json({
            status: true,
            data: rows,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(countRows[0].total / limit),
                totalRecords: countRows[0].total,
                limit: limit
            }
        });

    } catch (error) {
        console.error("Error fetching commission ledger:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching the commission ledger." });
    }
};