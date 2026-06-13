const express = require('express');
const router = express.Router();
const Admin = require('./src/Routes/adminRoute');
const User = require('./src/Routes/userRoute');
const BrandRoutes = require('./src/Routes/brandRoutes');
const AttributeRoutes = require('./src/Routes/attributeRoutes');


const HsnCodes = require('./src/Routes/hsnCodeRoutes'); // We will create this next
const productRoutes = require('./src/Routes/productRoute'); 
const sellerProductRoutes = require('./src/Routes/sellerProductRoute'); // New

const settingsRoutes = require('./src/Routes/settingsRoutes');
const ledgerRoutes = require('./src/Routes/ledgerRoutes');
const bannerRoutes = require('./src/Routes/bannerRoutes');
const cartRoutes = require('./src/Routes/cartRoutes');


const kycRoutes = require('./src/Routes/kycRoutes');

const addressRoutes = require('./src/Routes/addressRoutes');

const orderRoutes = require('./src/Routes/orderRoutes'); 

const adminOrderRoutes = require('./src/Routes/adminOrderRoutes');

const deliveryAgentRoutes = require('./src/Routes/deliveryAgentRoutes');

const authRoutes = require('./src/Routes/authRoutes');

// --- IMPORT THE MISSING ROUTE FILE ---
const notificationRoutes = require('./src/Routes/notificationRoutes');

const retailerRoutes = require('./src/Routes/retailerRoutes');

const merchantRoutes = require('./src/Routes/merchantRoutes'); 

const paymentWebhookRoutes = require('./src/Routes/paymentWebhookRoutes'); // <-- ADD THIS

const paymentRoutes = require('./src/Routes/paymentRoute');

const retailerAuthRoutes = require('./src/Routes/retailerAuthRoutes');
const retailerInventoryRoutes = require('./src/Routes/retailerInventoryRoutes');
const deliveryAppRoute = require('./src/Routes/deliveryAppRoutes');


router.use('/auth', authRoutes);

router.use('/admin', Admin);
router.use('/user', User);
router.use('/attributeRoutes', AttributeRoutes);
router.use('/brand', BrandRoutes);
router.use('/hsnCodes', HsnCodes);
router.use('/products', productRoutes);         // For master catalog
router.use('/inventory', sellerProductRoutes);  // For seller offers & search
router.use('/settings', settingsRoutes);
router.use('/ledger', ledgerRoutes);

router.use('/banners', bannerRoutes);
router.use('/cart', cartRoutes);

router.use('/kyc', kycRoutes);

router.use('/addresses', addressRoutes);
router.use('/orders', orderRoutes);

router.use('/admin/orders', adminOrderRoutes);
router.use('/admin/delivery-agents', deliveryAgentRoutes);

router.use('/notifications', notificationRoutes);

router.use('/retailer', retailerRoutes);

router.use('/merchant', merchantRoutes);

router.use('/webhooks', paymentWebhookRoutes); // <-- ADD THIS

router.use('/payment', paymentRoutes);

router.use('/retailer/auth', retailerAuthRoutes);           // Login
router.use('/retailer/inventory', retailerInventoryRoutes); // Inventory Management

router.use('/delivery-app', deliveryAppRoute); // Inventory Management


// Temporary Binary Tree Diagnostics Endpoint
router.get('/diagnose-binary-tree', async (req, res) => {
    const db = require('./db');
    try {
        const u1 = req.query.user1 ? parseInt(req.query.user1) : null;
        const u2 = req.query.user2 ? parseInt(req.query.user2) : null;

        // 1. Fetch all users
        const [users] = await db.query(
            "SELECT id, username, binary_placement_id, binary_position, left_leg_bv, right_leg_bv FROM users WHERE is_deleted = 0"
        );

        const userMap = {};
        for (const u of users) {
            userMap[u.id] = { ...u, left_children: [], right_children: [], extra: [] };
        }

        // 2. Integrity Checks
        const conflicts = [];
        const loops = [];
        const orphans = [];

        for (const u of users) {
            const pid = u.binary_placement_id;
            if (pid) {
                const parent = userMap[pid];
                if (!parent) {
                    orphans.push({ user_id: u.id, username: u.username, missing_parent_id: pid });
                } else {
                    if (u.binary_position === 'LEFT') {
                        parent.left_children.push(u.id);
                    } else if (u.binary_position === 'RIGHT') {
                        parent.right_children.push(u.id);
                    } else {
                        parent.extra.push(u.id);
                    }
                }
            }

            // Loop check
            let currentId = u.id;
            const pathSet = new Set();
            let loopDetected = false;
            while (currentId) {
                if (pathSet.has(currentId)) {
                    loopDetected = true;
                    break;
                }
                pathSet.add(currentId);
                const currNode = userMap[currentId];
                if (!currNode || !currNode.binary_placement_id) break;
                currentId = currNode.binary_placement_id;
            }
            if (loopDetected) {
                loops.push({ user_id: u.id, username: u.username });
            }
        }

        // Detect multiple children on same leg
        for (const u of users) {
            const parent = userMap[u.id];
            if (parent) {
                if (parent.left_children.length > 1) {
                    conflicts.push({
                        parent_id: parent.id,
                        parent_username: parent.username,
                        leg: 'LEFT',
                        child_ids: parent.left_children,
                        child_usernames: parent.left_children.map(id => userMap[id]?.username)
                    });
                }
                if (parent.right_children.length > 1) {
                    conflicts.push({
                        parent_id: parent.id,
                        parent_username: parent.username,
                        leg: 'RIGHT',
                        child_ids: parent.right_children,
                        child_usernames: parent.right_children.map(id => userMap[id]?.username)
                    });
                }
            }
        }

        // 3. Path & LCA Analyzer
        let lcaAnalysis = null;
        
        const getPath = (userId) => {
            const path = [];
            let currentId = userId;
            const visited = new Set();
            while (currentId) {
                if (visited.has(currentId)) break; // prevent infinite loop
                visited.add(currentId);
                const node = userMap[currentId];
                if (!node) break;
                path.push(node);
                currentId = node.binary_placement_id;
            }
            return path;
        };

        if (u1 && u2) {
            const path1 = getPath(u1);
            const path2 = getPath(u2);

            // Reverse to trace top-down
            const path1Rev = [...path1].reverse();
            const path2Rev = [...path2].reverse();

            let lca = null;
            let lcaIdx1 = -1;
            let lcaIdx2 = -1;

            // Find LCA
            for (let i = 0; i < path1Rev.length; i++) {
                for (let j = 0; j < path2Rev.length; j++) {
                    if (path1Rev[i].id === path2Rev[j].id) {
                        lca = path1Rev[i];
                        lcaIdx1 = path1.findIndex(n => n.id === lca.id);
                        lcaIdx2 = path2.findIndex(n => n.id === lca.id);
                    }
                }
            }

            if (lca) {
                // Determine which leg of the LCA each user is on
                let u1_leg_relative_to_lca = null;
                let u2_leg_relative_to_lca = null;
                let u1_branch_node = null;
                let u2_branch_node = null;

                if (lcaIdx1 > 0) {
                    u1_branch_node = path1[lcaIdx1 - 1];
                    u1_leg_relative_to_lca = u1_branch_node.binary_position;
                } else {
                    u1_leg_relative_to_lca = "LCA_ITSELF";
                }

                if (lcaIdx2 > 0) {
                    u2_branch_node = path2[lcaIdx2 - 1];
                    u2_leg_relative_to_lca = u2_branch_node.binary_position;
                } else {
                    u2_leg_relative_to_lca = "LCA_ITSELF";
                }

                lcaAnalysis = {
                    lowest_common_ancestor: {
                        id: lca.id,
                        username: lca.username
                    },
                    user1: {
                        id: u1,
                        username: userMap[u1]?.username || "Unknown",
                        leg_relative_to_lca: u1_leg_relative_to_lca,
                        branch_node_under_lca: u1_branch_node ? { id: u1_branch_node.id, username: u1_branch_node.username } : null
                    },
                    user2: {
                        id: u2,
                        username: userMap[u2]?.username || "Unknown",
                        leg_relative_to_lca: u2_leg_relative_to_lca,
                        branch_node_under_lca: u2_branch_node ? { id: u2_branch_node.id, username: u2_branch_node.username } : null
                    },
                    are_in_opposite_legs: (u1_leg_relative_to_lca !== "LCA_ITSELF" && u2_leg_relative_to_lca !== "LCA_ITSELF" && u1_leg_relative_to_lca !== u2_leg_relative_to_lca)
                };
            } else {
                lcaAnalysis = {
                    error: "No common ancestor found between the two users. They are in completely disconnected trees."
                };
            }
        }

        // Search user if requested
        let searchResults = null;
        if (req.query.search) {
            const matchedUsers = users.filter(u => u.username.toLowerCase().includes(req.query.search.toLowerCase()));
            searchResults = [];
            for (const u of matchedUsers) {
                const [userMeta] = await db.query(
                    "SELECT total_matched_bv, binary_level_matched FROM users WHERE id = ?",
                    [u.id]
                );
                const [unmatchedEntries] = await db.query(
                    "SELECT id, bv_amount, matched_amount, leg, depth, source_user_id FROM user_binary_bv_entries WHERE user_id = ? AND bv_amount > matched_amount",
                    [u.id]
                );
                const [payouts] = await db.query(
                    "SELECT id, matched_bv, payout_percentage, payout_amount, remarks, created_at FROM binary_matching_payouts WHERE user_id = ?",
                    [u.id]
                );
                searchResults.push({
                    id: u.id,
                    username: u.username,
                    binary_placement_id: u.binary_placement_id,
                    binary_position: u.binary_position,
                    left_leg_bv: u.left_leg_bv,
                    right_leg_bv: u.right_leg_bv,
                    total_matched_bv: userMeta[0]?.total_matched_bv || 0,
                    binary_level_matched: userMeta[0]?.binary_level_matched || 0,
                    unmatched_entries: unmatchedEntries.map(e => `Entry ID: ${e.id}, BV: ${e.bv_amount}, Matched: ${e.matched_amount}, leg: ${e.leg}, depth: ${e.depth} (Source User ID: ${e.source_user_id})`),
                    payout_history: payouts.map(p => `Payout ID: ${p.id}, Matched BV: ${p.matched_bv}, Payout %: ${p.payout_percentage}%, Paid: ₹${p.payout_amount} (${p.remarks})`)
                });
            }
        }

        // List all roots (users with no binary parent)
        const rootsList = users
            .filter(u => !u.binary_placement_id)
            .map(u => ({
                id: u.id,
                username: u.username,
                left_bv: u.left_leg_bv,
                right_bv: u.right_leg_bv
            }));

        res.status(200).json({
            status: true,
            total_active_users: users.length,
            integrity_summary: {
                duplicate_leg_conflicts_count: conflicts.length,
                loops_count: loops.length,
                orphans_count: orphans.length
            },
            conflicts,
            loops,
            orphans,
            lca_analysis: lcaAnalysis,
            search_results: searchResults,
            root_users: rootsList,
            user1_path_to_root: u1 ? (userMap[u1] ? getPath(u1).map(p => `${p.username} (ID: ${p.id}, position: ${p.binary_position}, left_bv: ${p.left_leg_bv}, right_bv: ${p.right_leg_bv})`) : "User not found") : null,
            user2_path_to_root: u2 ? (userMap[u2] ? getPath(u2).map(p => `${p.username} (ID: ${p.id}, position: ${p.binary_position}, left_bv: ${p.left_leg_bv}, right_bv: ${p.right_leg_bv})`) : "User not found") : null
        });

    } catch (err) {
        res.status(500).json({ status: false, error: err.message });
    }
});


module.exports = router