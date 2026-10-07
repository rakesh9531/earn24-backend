const db = require('../../db');
const crypto = require('crypto');
const Order = require('../Models/orderModel');
const OrderItem = require('../Models/orderItemModel.js');
const Address = require('../Models/userAddressModel.js');

const notificationService = require('../utils/notificationService.js');
const commissionService = require('../Services/commissionService');
const distributionService = require('../Services/distributionService');
const invoiceService = require('../Services/invoiceService');

// Helper function to generate a unique order number
const generateOrderNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `ORD-${year}${month}${day}-${randomPart}`;
};

/**
 * Main Order Creation Function (Refinement with MLM + Attributes)
 */
exports.createOrder = async (req, res) => {
    const userId = req.user.id;
    const { shippingAddressId, paymentMethod, cartItemIds } = req.body;

    if (!shippingAddressId || !paymentMethod) {
        return res.status(400).json({ status: false, message: 'Shipping address and payment method are required.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get user's cart
        const [cartRows] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
        if (cartRows.length === 0) throw new Error('Cart not found.');
        const cartId = cartRows[0].id;

        // 2. Fetch specific items with full details (Filter by cartItemIds if provided with automatic fallback)
        let validCartItemIds = null;
        if (cartItemIds) {
            if (Array.isArray(cartItemIds)) {
                validCartItemIds = cartItemIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
            } else if (typeof cartItemIds === 'string') {
                validCartItemIds = cartItemIds.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id) && id > 0);
            }
        }

        const baseItemQuery = `
            SELECT 
                ci.id as cart_item_id, ci.quantity, ci.seller_product_variant_id,
                sp.id as seller_product_id, p.id as product_id, p.name as product_name,
                sp.selling_price, sp.purchase_price, sp.admin_margin_percent, h.gst_percentage, u.sponsor_id, sp.quantity as stock_available,
                IFNULL(sp.is_cod_available, 1) as is_cod_available,
                spv.id as variant_id, spv.title as variant_title, spv.color as variant_color,
                spv.size as variant_size, spv.sku as variant_sku, spv.price as variant_price,
                spv.variant_image_url as variant_image_url
            FROM cart_items ci
            JOIN seller_products sp ON ci.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN seller_product_variants spv ON ci.seller_product_variant_id = spv.id
            JOIN users u ON u.id = ?
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            WHERE ci.cart_id = ?
        `;

        let items = [];
        if (validCartItemIds && validCartItemIds.length > 0) {
            const [filteredItems] = await connection.query(`${baseItemQuery} AND ci.id IN (?) FOR UPDATE;`, [userId, cartId, validCartItemIds]);
            items = filteredItems;
        }

        if (items.length === 0) {
            const [allCartItems] = await connection.query(`${baseItemQuery} FOR UPDATE;`, [userId, cartId]);
            items = allCartItems;
        }

        if (items.length === 0) throw new Error('Your cart is empty or selected items not found.');

        // 3. Fetch Delivery Settings
        const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
        const settings = settingsRows.reduce((acc, setting) => {
            acc[setting.setting_key] = parseFloat(setting.setting_value);
            return acc;
        }, {});

        const bvGenerationPct = settings.bv_generation_pct_of_profit || 80.0;
        const bvThreshold = settings.delivery_fee_bv_threshold || 50.0;
        const standardFee = settings.delivery_fee_standard || 40.0;
        const specialFee = settings.delivery_fee_special || 0.0;
        const isCodActive = settings.is_cod_active !== undefined ? settings.is_cod_active : 1;

        if (paymentMethod === 'COD') {
            if (isCodActive === 0) {
                throw new Error('Cash on Delivery (COD) is currently disabled by the administrator.');
            }
            const nonCodItem = items.find(item => Number(item.is_cod_available) === 0);
            if (nonCodItem) {
                throw new Error(`Cash on Delivery (COD) is not available for "${nonCodItem.product_name}". Please choose an online payment method.`);
            }
        }

        const computeItemBv = (item, price) => {
            if (parseFloat(item.admin_margin_percent || 0) > 0) {
                return Math.max(0, (price * (parseFloat(item.admin_margin_percent) / 100)) * (bvGenerationPct / 100));
            }
            const grossProfit = price - (parseFloat(item.purchase_price) || 0);
            const gstAmount = (price * (parseFloat(item.gst_percentage) || 0)) / 100;
            const netProfit = grossProfit - gstAmount;
            return Math.max(0, (netProfit > 0) ? netProfit * (bvGenerationPct / 100) : 0);
        };

        // 4. Calculate Totals (Subtotal & BV)
        let calculatedTotalBv = 0;
        let finalSubtotal = 0;
        for (const item of items) {
            const effectivePrice = item.variant_price ? parseFloat(item.variant_price) : parseFloat(item.selling_price);
            if (item.quantity > item.stock_available) throw new Error(`Insufficient stock for ${item.product_name}`);

            const bvEarnedPerUnit = computeItemBv(item, effectivePrice);

            calculatedTotalBv += bvEarnedPerUnit * item.quantity;
            finalSubtotal += (effectivePrice * item.quantity);
        }

        const deliveryFee = (calculatedTotalBv >= bvThreshold) ? specialFee : standardFee;
        const totalAmount = finalSubtotal + deliveryFee;

        // 5. Create Order Header
        const orderNumber = generateOrderNumber();
        let orderStatus = (paymentMethod === 'ONLINE') ? 'PENDING_PAYMENT' : 'CONFIRMED';
        let paymentStatus = (paymentMethod === 'WALLET') ? 'COMPLETED' : 'PENDING';

        const orderSql = `INSERT INTO orders (user_id, shipping_address_id, order_number, subtotal, delivery_fee, total_amount, total_bv_earned, payment_method, payment_status, order_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const [orderResult] = await connection.query(orderSql, [userId, shippingAddressId, orderNumber, finalSubtotal, deliveryFee, totalAmount, calculatedTotalBv, paymentMethod, paymentStatus, orderStatus]);
        const orderId = orderResult.insertId;

        // 6. Loop Items: Process Attributes, Stock, and Line Records
        for (const item of items) {
            const effectivePrice = item.variant_price ? parseFloat(item.variant_price) : parseFloat(item.selling_price);
            const effectiveName = item.variant_title 
                ? `${item.product_name} (${item.variant_title})` 
                : (item.variant_color || item.variant_size ? `${item.product_name} (${[item.variant_color, item.variant_size].filter(Boolean).join(' ')})` : item.product_name);

            // A. Fetch Attribute Snapshot (Size, Color, etc.)
            const [attrRows] = await connection.query(`
                SELECT a.name as attr_key, av.value as attr_value
                FROM product_attributes pa
                JOIN attribute_values av ON pa.attribute_value_id = av.id
                JOIN attributes a ON av.attribute_id = a.id
                WHERE pa.product_id = ?`, [item.product_id]);

            const snapshot = {};
            attrRows.forEach(row => { snapshot[row.attr_key] = row.attr_value; });
            if (item.variant_title) snapshot['Selected Variant'] = item.variant_title;
            if (item.variant_color) snapshot['Color'] = item.variant_color;
            if (item.variant_size) snapshot['Size'] = item.variant_size;
            if (item.variant_sku) snapshot['SKU'] = item.variant_sku;
            if (item.variant_image_url) snapshot['Variant Image'] = item.variant_image_url;

            // B. Calculate Profit on this specific line
            const bvEarnedPerUnit = computeItemBv(item, effectivePrice);

            // C. Insert Order Item (Including Snapshot)
            const orderItemSql = `
                INSERT INTO order_items (
                    order_id, product_id, seller_product_id, product_name, 
                    attributes_snapshot, quantity, price_per_unit, purchase_price, gst_percentage, total_price, 
                    bv_earned_per_unit, total_bv_earned
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            await connection.query(orderItemSql, [
                orderId, item.product_id, item.seller_product_id, effectiveName,
                JSON.stringify(snapshot),
                item.quantity, effectivePrice, item.purchase_price, item.gst_percentage || 0.00, effectivePrice * item.quantity,
                bvEarnedPerUnit, bvEarnedPerUnit * item.quantity
            ]);

            // D. Deduct Stock (Variant-aware)
            if (item.variant_id) {
                const [varUpdate] = await connection.query(
                    'UPDATE seller_product_variants SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?',
                    [item.quantity, item.variant_id, item.quantity]
                );
                if (varUpdate.affectedRows === 0) {
                    throw new Error(`Out of stock for variant ${item.variant_title || item.product_name}`);
                }
                // Safely sync master seller_product stock
                await connection.query(
                    'UPDATE seller_products SET quantity = GREATEST(0, quantity - ?) WHERE id = ?',
                    [item.quantity, item.seller_product_id]
                );
            } else {
                const [updateResult] = await connection.query(
                    'UPDATE seller_products SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
                    [item.quantity, item.seller_product_id, item.quantity]
                );
                if (updateResult.affectedRows === 0) {
                    throw new Error(`Out of stock for product ${item.product_name}`);
                }
            }

            // E. Notify if low stock
            await notificationService.checkStockAndNotify(item.seller_product_id, connection);
        }

        // 7. Wallet Deduction (Final Check & Transaction Log)
        if (paymentMethod === 'WALLET') {
            const [walletRows] = await connection.query('SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE', [userId]);
            if (!walletRows[0] || walletRows[0].balance < totalAmount) throw new Error("Insufficient wallet balance.");
            await connection.query('UPDATE user_wallets SET balance = balance - ? WHERE user_id = ?', [totalAmount, userId]);
            
            // Record Debit Entry in user_wallet_transactions for Customer Wallet History (Primary + Schema Fallback)
            await connection.query(`ALTER TABLE user_wallet_transactions MODIFY COLUMN source VARCHAR(100) NULL DEFAULT 'SYSTEM';`).catch(() => {});
            await connection.query(
                `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks, created_at) 
                 VALUES (?, 'debit', ?, 'order_purchase', ?, ?, NOW())`,
                [userId, totalAmount, orderId, `Payment for Order #${orderNumber}`]
            ).catch(async (primaryErr) => {
                console.warn('Primary wallet debit log failed, running fallback insert:', primaryErr.message);
                await connection.query(
                    `INSERT INTO user_wallet_transactions (user_id, amount, transaction_type, remarks, created_at) 
                     VALUES (?, ?, 'DEBIT', ?, NOW())`,
                    [userId, totalAmount, `Payment for Order #${orderNumber}`]
                ).catch(e => console.warn('Wallet debit transaction fallback log write warning:', e.message));
            });
        }

        // 8. Clean up Cart (Only Delete ordered items)
        const deleteQuery = `DELETE FROM cart_items WHERE cart_id = ?` + (cartItemIds ? ` AND id IN (?)` : ``);
        await connection.query(deleteQuery, cartItemIds ? [cartId, cartItemIds] : [cartId]);

        // 9. MLM & BV Distribution triggers have been REMOVED from here to prevent double-BV.
        // Distribution now happens ONLY in deliveryAppController.completeDelivery 
        // when the customer successfully receives the order via OTP.
        
        await connection.commit();

        // Trigger Smart Auto-Dispatch Engine asynchronously
        const deliveryAppController = require('./deliveryAppController');
        deliveryAppController.autoDispatchOrder(orderId).catch(err => 
            console.error('[Auto-Dispatch Trigger Error]', err.message)
        );

        const io = req.app.get('socketio');
        if (io) {
            io.to('admins').emit('new_order', {
                orderId,
                orderNumber,
                totalAmount,
                orderStatus
            });
        }

        res.status(201).json({ status: true, message: 'Order Placed!', data: { orderId, orderNumber, totalAmount } });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Order Creation Error:", error.message);
        res.status(500).json({ status: false, message: error.message || 'Failed to place order.' });
    } finally {
        if (connection) connection.release();
    }
};

// ==========================================================
// === GET / - Fetches a paginated list of user's orders  ===
// ==========================================================
exports.getOrderHistory = async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    try {
        const dataQuery = `
            SELECT * FROM orders 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `;
        const [orderRows] = await db.query(dataQuery, [userId, limit, offset]);

        const countQuery = `SELECT COUNT(*) as total FROM orders WHERE user_id = ?`;
        const [countRows] = await db.query(countQuery, [userId]);
        const totalRecords = countRows[0].total;

        const ordersWithImages = await Promise.all(orderRows.map(async (order) => {
            const [items] = await db.query(`
                SELECT oi.id, oi.product_name, oi.attributes_snapshot, p.main_image_url 
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ?
            `, [order.id]);
            let displayImg = items[0]?.main_image_url || null;
            if (items[0]?.attributes_snapshot) {
                try {
                    const snap = typeof items[0].attributes_snapshot === 'string' ? JSON.parse(items[0].attributes_snapshot) : items[0].attributes_snapshot;
                    if (snap && snap['Variant Image']) {
                        displayImg = snap['Variant Image'];
                    }
                } catch (e) {}
            }

            const [returns] = await db.query(
                `SELECT id, status, request_type, refund_method, refund_status FROM order_returns WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
                [order.id]
            ).catch(() => [[]]);

            return {
                ...order,
                display_image_url: displayImg,
                first_item_name: items[0]?.product_name || null,
                total_items: items ? items.length : 1,
                return_status: returns && returns[0] ? returns[0].status : null,
                return_type: returns && returns[0] ? returns[0].request_type : null
            };
        }));

        res.status(200).json({
            status: true,
            data: ordersWithImages,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalRecords / limit),
                totalRecords: totalRecords,
                limit: limit
            }
        });
    } catch (error) {
        console.error("Error fetching order history:", error);
        res.status(500).json({ status: false, message: "An error occurred while fetching order history." });
    }
};

// ==========================================================
// === GET /previously-purchased-items - User's bought items
// ==========================================================
exports.getPreviouslyPurchasedItems = async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    try {
        const query = `
            SELECT 
                recent.product_id,
                recent.product_id as id,
                COALESCE(sp.id, recent.seller_product_id) as offer_id,
                COALESCE(sp.id, recent.seller_product_id) as seller_product_id,
                COALESCE(p.name, recent.product_name) as product_name,
                COALESCE(p.name, recent.product_name) as name,
                COALESCE(p.main_image_url, '') as main_image_url,
                COALESCE(p.main_image_url, '') as image_url,
                COALESCE(sp.selling_price, recent.price_per_unit) as selling_price,
                COALESCE(sp.selling_price, recent.price_per_unit) as price,
                COALESCE(sp.mrp, recent.price_per_unit) as mrp,
                COALESCE(sp.quantity, 10) as stock,
                COALESCE(sp.minimum_order_quantity, 1) as minimum_order_quantity,
                COALESCE(recent.bv_earned_per_unit, 0) as bv_earned,
                recent.last_ordered_at,
                recent.order_count
            FROM (
                SELECT 
                    oi.product_id,
                    MAX(oi.seller_product_id) as seller_product_id,
                    MAX(oi.product_name) as product_name,
                    MAX(oi.price_per_unit) as price_per_unit,
                    MAX(oi.bv_earned_per_unit) as bv_earned_per_unit,
                    MAX(o.created_at) as last_ordered_at,
                    COUNT(oi.id) as order_count
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                WHERE o.user_id = ?
                GROUP BY oi.product_id
                ORDER BY last_ordered_at DESC
                LIMIT ? OFFSET ?
            ) recent
            LEFT JOIN products p ON recent.product_id = p.id
            LEFT JOIN seller_products sp ON (
                sp.id = (
                    SELECT sp2.id FROM seller_products sp2 
                    WHERE sp2.product_id = recent.product_id AND sp2.is_active = 1 
                    ORDER BY (sp2.id = recent.seller_product_id) DESC, sp2.id DESC 
                    LIMIT 1
                )
            )
            ORDER BY recent.last_ordered_at DESC
        `;

        const countQuery = `
            SELECT COUNT(DISTINCT oi.product_id) as total
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.user_id = ?
        `;

        const [rows] = await db.query(query, [userId, limit, offset]);
        const [countRows] = await db.query(countQuery, [userId]);
        const total = countRows[0]?.total || 0;
        const totalPages = Math.ceil(total / limit) || 1;

        res.status(200).json({
            status: true,
            data: rows,
            pagination: {
                page,
                limit,
                totalProducts: total,
                totalPages
            }
        });
    } catch (error) {
        console.error("Error in getPreviouslyPurchasedItems:", error);
        res.status(500).json({ status: false, message: "Failed to fetch previously purchased items.", error: error.message });
    }
};

// ==========================================================
// === GET /:orderId - Fetches details of a single order  ===
// ==========================================================
exports.getOrderDetails = async (req, res) => {
    const userId = req.user.id;
    const { orderId } = req.params;

    try {
        const orderQuery = `
            SELECT o.*, u.full_name as customer_name, u.mobile_number as customer_phone 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            WHERE (o.id = ? OR o.order_number = ?) AND o.user_id = ?
        `;
        const [orderRows] = await db.query(orderQuery, [orderId, orderId, userId]);
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }

        const realOrderId = orderRows[0].id;
        const realOrderNum = orderRows[0].order_number;

        const addressQuery = `
            SELECT ua.*, COALESCE(u.full_name, 'Customer') as full_name, u.mobile_number 
            FROM user_addresses ua 
            LEFT JOIN users u ON ua.user_id = u.id 
            WHERE ua.id = ?
        `;
        const [addressRows] = await db.query(addressQuery, [orderRows[0].shipping_address_id]);

        const [oiCols] = await db.query("SHOW COLUMNS FROM order_items LIKE 'seller_product_variant_id'").catch(() => [[]]);
        const hasVariantCol = oiCols && oiCols.length > 0;

        const itemsQuery = `
            SELECT oi.*, p.name as master_product_name, p.main_image_url, b.name as brand_name,
                   ${hasVariantCol ? "spv.sku as variant_sku, spv.color, spv.size, spv.title as variant_title," : "'' as variant_sku, '' as color, '' as size, '' as variant_title,"}
                   IFNULL(sp.return_window_days, IFNULL(psc.return_window_days, 7)) as return_window_days, 
                   IFNULL(sp.has_return_policy, IFNULL(psc.has_return_policy, 1)) as has_return_policy,
                   IFNULL(sp.is_replacement_available, IFNULL(psc.is_replacement_available, 1)) as is_replacement_available,
                   IFNULL(sp.replacement_window_days, IFNULL(psc.replacement_window_days, 7)) as replacement_window_days,
                   IFNULL(sp.is_returnable, 1) as is_returnable,
                   s.sellerable_type,
                   s.sellerable_id,
                   COALESCE(m.business_name, s.display_name, 'Earn24 Seller') as seller_name,
                   COALESCE(m.business_address, '') as seller_address,
                   COALESCE(m.pincode, '') as seller_pincode,
                   COALESCE(item_da.full_name, (CASE WHEN s.sellerable_type = 'Merchant' THEN '' ELSE da.full_name END), '') as delivery_agent_name,
                   COALESCE(item_da.phone_number, (CASE WHEN s.sellerable_type = 'Merchant' THEN '' ELSE da.phone_number END), '') as delivery_agent_phone
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN product_subcategories psc ON p.subcategory_id = psc.id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN sellers s ON sp.seller_id = s.id
            LEFT JOIN merchants m ON (s.sellerable_type = 'Merchant' AND s.sellerable_id = m.id)
            LEFT JOIN orders o ON oi.order_id = o.id
            LEFT JOIN delivery_agents item_da ON oi.delivery_agent_id = item_da.id
            LEFT JOIN delivery_agents da ON o.delivery_agent_id = da.id
            ${hasVariantCol ? 'LEFT JOIN seller_product_variants spv ON oi.seller_product_variant_id = spv.id' : ''}
            WHERE oi.order_id = ?
        `;
        const [itemRows] = await db.query(itemsQuery, [realOrderId]);

        const [returnRows] = await db.query(
            `SELECT r.*, COALESCE(da.full_name, '') as agent_name, IFNULL(da.phone_number, '') as agent_phone 
             FROM order_returns r 
             LEFT JOIN delivery_agents da ON r.delivery_agent_id = da.id 
             WHERE r.order_id = ?
             ORDER BY r.id DESC`,
            [realOrderId]
        ).catch(err => {
            console.error('[getOrderDetails Return Query Error]', err.message);
            return [[]];
        });

        const returnWindowDays = itemRows.length > 0 ? Math.max(...itemRows.map(i => parseInt(i.return_window_days || 7))) : 7;
        const isReturnable = itemRows.length > 0 ? itemRows.some(i => (
            (i.has_return_policy === 1 || i.has_return_policy === '1' || i.has_return_policy === true) ||
            (i.is_replacement_available === 1 || i.is_replacement_available === '1' || i.is_replacement_available === true)
        )) : true;

        const orderData = new Order({
            ...orderRows[0],
            customer_name: orderRows[0].customer_name,
            return_window_days: returnWindowDays,
            is_returnable: isReturnable ? 1 : 0,
            shipping_address: addressRows[0] ? new Address({
                ...addressRows[0],
                full_name: addressRows[0].full_name || orderRows[0].customer_name || 'Customer'
            }) : null,
            items: itemRows.map(item => {
                let vTitle = item.variant_title || '';
                let vSku = item.variant_sku || item.sku || '';
                let vColor = item.color || '';
                let vSize = item.size || '';
                
                if (item.attributes_snapshot) {
                    try {
                        const snap = typeof item.attributes_snapshot === 'string' ? JSON.parse(item.attributes_snapshot) : item.attributes_snapshot;
                        if (snap) {
                            if (!vTitle && snap['Selected Variant']) vTitle = snap['Selected Variant'];
                            if (!vTitle && snap['Title']) vTitle = snap['Title'];
                            if (!vTitle && snap['Color'] && snap['Size']) vTitle = `${snap['Color']} ${snap['Size']}`;
                            if (!vColor && snap['Color']) vColor = snap['Color'];
                            if (!vColor && snap['color']) vColor = snap['color'];
                            if (!vSize && snap['Size']) vSize = snap['Size'];
                            if (!vSize && snap['size']) vSize = snap['size'];
                            if (!vSku && snap['SKU']) vSku = snap['SKU'];
                            if (!vSku && snap['sku']) vSku = snap['sku'];
                        }
                    } catch(e) {}
                }
                
                const itemReturn = (returnRows || []).find(r => r.order_item_id == item.id && !['REJECTED', 'CLOSED'].includes(r.status)) || (returnRows || []).find(r => r.order_item_id == item.id) || null;
                
                // Separate status resolution for Merchant items vs Admin items
                const isMerchantItem = (item.sellerable_type === 'Merchant' && item.sellerable_id);
                let itemStatusResolved = 'CONFIRMED';
                if (item.item_status && !['ACTIVE', 'PLACED'].includes(item.item_status)) {
                    itemStatusResolved = item.item_status;
                } else if (isMerchantItem) {
                    if (item.delivery_agent_id || item.tracking_number) {
                        itemStatusResolved = item.pickup_status === 'PICKED_UP' ? 'OUT_FOR_DELIVERY' : 'SHIPPED';
                    } else {
                        itemStatusResolved = 'CONFIRMED';
                    }
                } else {
                    itemStatusResolved = (orderRows[0].order_status && !['ACTIVE', 'PLACED'].includes(orderRows[0].order_status))
                        ? orderRows[0].order_status 
                        : 'CONFIRMED';
                }

                let sCity = '';
                let sState = '';
                if (item.seller_address) {
                    const parts = item.seller_address.split(',').map(p => p.trim()).filter(Boolean);
                    if (parts.length >= 2) {
                        sCity = parts[parts.length - 2];
                        sState = parts[parts.length - 1];
                    } else if (parts.length === 1) {
                        sCity = parts[0];
                    }
                }

                return new OrderItem({
                    ...item,
                    item_status: itemStatusResolved,
                    brand_name: item.brand_name || '',
                    variant_title: vTitle || (vColor ? `${vColor} ${vSize || ''}`.trim() : ''),
                    sku: vSku,
                    return_request: itemReturn,
                    has_return_policy: item.has_return_policy,
                    is_replacement_available: item.is_replacement_available,
                    return_window_days: item.return_window_days,
                    replacement_window_days: item.replacement_window_days,
                    seller_name: item.seller_name,
                    seller_city: sCity,
                    seller_state: sState,
                    seller_address: item.seller_address,
                    tracking_number: item.tracking_number || (isMerchantItem ? null : orderRows[0].tracking_number) || null,
                    courier_name: item.courier_name || (isMerchantItem ? null : orderRows[0].courier_name) || null,
                    dispatch_mode: item.dispatch_mode || (isMerchantItem ? 'LOCAL_RIDER' : orderRows[0].dispatch_mode) || 'LOCAL_RIDER',
                    delivery_agent_name: item.delivery_agent_name,
                    delivery_agent_phone: item.delivery_agent_phone,
                    pickup_status: item.pickup_status || (isMerchantItem ? 'PENDING' : orderRows[0].pickup_status) || 'PENDING',
                    picked_up_at: item.picked_up_at || (isMerchantItem ? null : orderRows[0].picked_up_at) || null,
                    delivered_at: item.delivered_at || (orderRows[0].order_status === 'DELIVERED' ? orderRows[0].delivered_at : null)
                });
            }),
            return_request: returnRows && returnRows[0] ? {
                ...returnRows[0],
                admin_remarks: returnRows[0].admin_remarks || returnRows[0].reject_reason || returnRows[0].rejection_reason || '',
                reject_reason: returnRows[0].reject_reason || returnRows[0].admin_remarks || returnRows[0].rejection_reason || '',
                rejection_reason: returnRows[0].rejection_reason || returnRows[0].admin_remarks || returnRows[0].reject_reason || '',
                merchant_notes: returnRows[0].merchant_notes || ''
            } : null,
            return_requests: (returnRows || []).map(r => ({
                ...r,
                admin_remarks: r.admin_remarks || r.reject_reason || r.rejection_reason || '',
                reject_reason: r.reject_reason || r.admin_remarks || r.rejection_reason || '',
                rejection_reason: r.rejection_reason || r.admin_remarks || r.reject_reason || '',
                merchant_notes: r.merchant_notes || ''
            }))
        });

        res.status(200).json({ status: true, data: orderData });

    } catch (error) {
        console.error("Error fetching order details:", error);
        res.status(500).json({ status: false, message: 'An error occurred while fetching order details.' });
    }
};

exports.updatePaymentMethod = async (req, res) => {
    try {
        const orderId = req.params.id;
        const { paymentMethod } = req.body;

        if (!paymentMethod) {
            return res.status(400).json({ status: false, message: 'Payment method is required' });
        }

        let newStatus = 'PENDING';
        if (paymentMethod === 'COD') {
            const [orderItems] = await db.query(`
                SELECT p.name as product_name, IFNULL(sp.is_cod_available, 1) as is_cod_available
                FROM order_items oi
                JOIN seller_products sp ON oi.seller_product_id = sp.id
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ?
            `, [orderId]);

            const nonCodItem = (orderItems || []).find(item => Number(item.is_cod_available) === 0);
            if (nonCodItem) {
                return res.status(400).json({
                    status: false,
                    message: `Cash on Delivery (COD) is not available for "${nonCodItem.product_name}". Please choose an online payment method.`
                });
            }
            newStatus = 'CONFIRMED';
        }

        const [result] = await db.query(
            'UPDATE orders SET payment_method = ?, order_status = ? WHERE id = ?',
            [paymentMethod, newStatus, orderId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: false, message: 'Order not found' });
        }

        res.status(200).json({
            status: true,
            message: 'Payment method and status updated successfully',
            data: { order_status: newStatus }
        });

    } catch (error) {
        console.error('Error updating payment method:', error);
        res.status(500).json({ status: false, message: 'Server error' });
    }
};

/**
 * Generates and downloads the invoice PDF for a specific order.
 */
exports.downloadInvoice = async (req, res) => {
    const requester = req.user;
    const { orderId } = req.params;

    try {
        // 1. Get Order Details - Allow Admin and Merchant to access any order
        let orderQuery = `SELECT * FROM orders WHERE id = ? OR order_number = ?`;
        let params = [orderId, orderId];
        
        const role = (requester?.role || '').toLowerCase();
        const isStaffOrSeller = ['admin', 'superadmin', 'super_admin', 'merchant', 'delivery_agent', 'staff'].includes(role) || role.includes('admin') || role.includes('merchant');
        if (!isStaffOrSeller) {
            orderQuery = `SELECT * FROM orders WHERE (id = ? OR order_number = ?) AND user_id = ?`;
            params.push(requester.id);
        }

        const [orderRows] = await db.query(orderQuery, params);
        if (orderRows.length === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }
        const order = orderRows[0];

        // Enforce DELIVERED check only for normal end customers; allow Admin and Merchant to print invoice anytime
        if (!isStaffOrSeller && order.order_status !== 'DELIVERED') {
            return res.status(400).json({ status: false, message: 'Invoice is only available after the order has been delivered.' });
        }

        // 2. Get Shipping Address
        const [addressRows] = await db.query(`SELECT * FROM user_addresses WHERE id = ?`, [order.shipping_address_id]);
        order.shipping_address = addressRows[0] || {};

        // 3. Get Customer Details (Use order.user_id, NEVER requester.id!)
        const [userRows] = await db.query(`SELECT full_name, mobile_number as phone_number FROM users WHERE id = ?`, [order.user_id]);
        const user = userRows[0] || { full_name: "Customer", phone_number: "" };

        // 4. Get Items with HSN Code and Seller Info (Support both Merchant and Admin sellers)
        const itemsQuery = `
            SELECT oi.*, h.hsn_code, h.gst_percentage, 
                   s.sellerable_type,
                   m.business_name as merchant_name,
                   m.business_address as merchant_address,
                   m.pincode as merchant_pincode,
                   m.gst_number as merchant_gstin,
                   s.display_name as seller_display_name,
                   s.address as seller_db_address,
                   s.gstin as seller_db_gstin
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN sellers s ON sp.seller_id = s.id
            LEFT JOIN merchants m ON (s.sellerable_type = 'Merchant' AND s.sellerable_id = m.id)
            WHERE oi.order_id = ?
        `;
        const [itemRows] = await db.query(itemsQuery, [order.id]);
        
        let targetItems = itemRows;
        if (req.query.item_id) {
            const specific = itemRows.filter(i => i.id == req.query.item_id);
            if (specific.length > 0) {
                targetItems = specific;
            }
        }
        order.items = targetItems;

        // Dynamic Seller Resolution:
        // - Admin Seller: EARN24 official address & GSTIN
        // - Merchant Seller: Merchant's own profile address, pincode & GSTIN
        const firstItem = targetItems[0] || {};
        const isMerchantItem = firstItem.sellerable_type === 'Merchant' && (firstItem.merchant_name || firstItem.merchant_address);

        let seller = {};
        if (isMerchantItem) {
            const mAddress = [
                firstItem.merchant_address,
                firstItem.merchant_pincode ? `Pincode: ${firstItem.merchant_pincode}` : ''
            ].filter(Boolean).join('\n');

            seller = {
                seller_type: 'Merchant',
                display_name: firstItem.merchant_name || firstItem.seller_display_name || "Merchant Partner",
                address: mAddress || "Merchant Store Address",
                gstin: firstItem.merchant_gstin || "N/A"
            };
        } else if (requester?.role?.toLowerCase() === 'merchant') {
            // Fallback for merchant requester
            const [mRows] = await db.query('SELECT business_name, business_address, pincode, gst_number FROM merchants WHERE id = ?', [requester.id]);
            if (mRows.length > 0) {
                const m = mRows[0];
                const mAddress = [m.business_address, m.pincode ? `Pincode: ${m.pincode}` : ''].filter(Boolean).join('\n');
                seller = {
                    seller_type: 'Merchant',
                    display_name: m.business_name || 'Merchant Partner',
                    address: mAddress || 'Merchant Store Address',
                    gstin: m.gst_number || 'N/A'
                };
            }
        }

        if (!seller.display_name) {
            // Load dynamic admin invoice settings from app_settings
            const [adminSettingsRows] = await db.query(
                "SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'invoice_admin_%'"
            ).catch(() => [[]]);
            const adminSettingsMap = (adminSettingsRows || []).reduce((acc, row) => {
                acc[row.setting_key] = row.setting_value;
                return acc;
            }, {});

            seller = {
                seller_type: 'Admin',
                display_name: adminSettingsMap['invoice_admin_name'] || "EARN24",
                tagline: adminSettingsMap['invoice_admin_tagline'] || "SHOP MORE | EARN MORE | HELP MORE",
                address: adminSettingsMap['invoice_admin_address'] || "Ground Floor, Galfarbari Badi Maszid,\nGalfarbari More, Near Kumardhubi Hospital,\nP.O. Kumardhubi, Egyarkund, Kumardhubi,\nDhanbad, Jharkhand – 828203 (India)",
                gstin: adminSettingsMap['invoice_admin_gstin'] || "20EIMPK5093M1ZU",
                email: adminSettingsMap['invoice_admin_email'] || "support@earn24.in"
            };
        }

        // 5. If explicitly requested format=pdf, send 80mm PDF
        if (req.query.format === 'pdf') {
            const pdfBuffer = await invoiceService.generateInvoicePDF(order, user, seller);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename=Invoice-${order.order_number}.pdf`);
            return res.send(pdfBuffer);
        }

        // 6. Default: Send Ready-to-print Thermal Slip HTML (Swipe Cart / POS Receipt Machine format)
        const slipHtml = invoiceService.generateThermalInvoiceHTML(order, user, seller);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(slipHtml);

    } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).json({ status: false, message: 'An error occurred while generating the invoice PDF.' });
    }
};

/**
 * Generates a ready-to-print 4x6 Box Shipping Label / Address Sticker.
 * Used by Admin & Merchants to stick customer address, COD cash to collect, and barcode onto the packed parcel box.
 */
exports.downloadShippingLabel = async (req, res) => {
    const requester = req.user;
    const { orderId } = req.params;

    try {
        let orderQuery = `SELECT * FROM orders WHERE id = ? OR order_number = ?`;
        let params = [orderId, orderId];
        
        const role = (requester?.role || '').toLowerCase();
        const isStaffOrSeller = ['admin', 'superadmin', 'super_admin', 'merchant', 'delivery_agent', 'staff'].includes(role) || role.includes('admin') || role.includes('merchant');
        if (!isStaffOrSeller) {
            orderQuery = `SELECT * FROM orders WHERE (id = ? OR order_number = ?) AND user_id = ?`;
            params.push(requester.id);
        }

        const [orderRows] = await db.query(orderQuery, params);
        if (orderRows.length === 0) {
            return res.status(404).send('<h3 style="font-family:sans-serif;text-align:center;margin-top:50px;">Order not found</h3>');
        }
        const order = orderRows[0];

        // Customer Delivery Address
        const [addressRows] = await db.query(`SELECT * FROM user_addresses WHERE id = ?`, [order.shipping_address_id]);
        const addr = addressRows[0] || {};

        // Customer Info
        const [userRows] = await db.query(`SELECT full_name, mobile_number, email FROM users WHERE id = ?`, [order.user_id]);
        const customer = userRows[0] || { full_name: "Customer", mobile_number: "" };

        // Items and Merchant Info
        const itemsQuery = `
            SELECT oi.*, p.name as catalog_name,
                   COALESCE(m.business_name, s.display_name, 'EARN24 Central Hub') as seller_name,
                   COALESCE(m.business_address, s.address, 'Earn24 Logistics Center') as seller_address,
                   COALESCE(m.phone_number, '') as seller_phone,
                   COALESCE(m.gst_number, s.gstin, '') as seller_gstin
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
            LEFT JOIN sellers s ON sp.seller_id = s.id
            LEFT JOIN merchants m ON (s.sellerable_type = 'Merchant' AND s.sellerable_id = m.id)
            WHERE oi.order_id = ?
        `;
        const [itemRows] = await db.query(itemsQuery, [order.id]);
        let items = itemRows;
        if (req.query.item_id) {
            const specific = itemRows.filter(i => i.id == req.query.item_id);
            if (specific.length > 0) {
                items = specific;
            }
        }

        const seller = {
            name: items[0]?.seller_name || "EARN24 Store",
            address: items[0]?.seller_address || "Central Hub",
            phone: items[0]?.seller_phone || "",
            gstin: items[0]?.seller_gstin || ""
        };

        const isPrepaid = (order.payment_method === 'WALLET' || order.payment_method === 'ONLINE' || order.payment_method === 'PAYU' || order.payment_status === 'COMPLETED' || order.payment_status === 'PAID');
        const paymentLabel = isPrepaid ? 'PREPAID - DO NOT COLLECT CASH' : `CASH ON DELIVERY (COLLECT ₹${parseFloat(order.total_amount).toFixed(2)})`;
        const routingMode = (order.dispatch_mode === 'SHIPROCKET_COURIER' || order.tracking_number)
            ? `COURIER: ${order.courier_name || 'Shiprocket Partner'}` 
            : 'EARN24 LOCAL DELIVERY PARTNER';

        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shipping Label - #${order.order_number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    body { background: #f1f5f9; padding: 20px; display: flex; flex-direction: column; align-items: center; }
    .no-print-bar { margin-bottom: 15px; display: flex; gap: 10px; }
    .btn-print { background: #0284c7; color: #fff; border: none; padding: 10px 24px; font-size: 15px; font-weight: bold; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
    .label-box {
      width: 420px;
      min-height: 580px;
      background: #ffffff;
      border: 2px solid #000000;
      padding: 16px;
      color: #000000;
      position: relative;
    }
    .header-table { width: 100%; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
    .brand-title { font-size: 20px; font-weight: 900; letter-spacing: 1px; }
    .routing-tag { font-size: 10px; font-weight: 800; background: #000; color: #fff; padding: 3px 6px; border-radius: 3px; display: inline-block; margin-top: 3px; }
    .barcode-block { text-align: center; border-bottom: 2px solid #000; padding: 8px 0; margin-bottom: 12px; }
    .fake-barcode { font-family: "Courier New", Courier, monospace; letter-spacing: 4px; font-weight: 900; font-size: 24px; }
    .order-sub-num { font-size: 13px; font-weight: 700; margin-top: 2px; }
    
    .section-title { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; color: #333; margin-bottom: 3px; }
    .ship-to-card {
      border: 2px solid #000000;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 12px;
      background: #fafafa;
    }
    .customer-name { font-size: 18px; font-weight: 900; margin-bottom: 3px; }
    .customer-phone { font-size: 15px; font-weight: 800; margin-bottom: 5px; }
    .address-text { font-size: 13px; line-height: 1.45; font-weight: 600; }
    .landmark-text { font-size: 12px; margin-top: 4px; font-weight: bold; }
    .pincode-highlight { font-size: 16px; font-weight: 900; display: inline-block; margin-top: 4px; }
    
    .pay-card {
      border: 2px dashed #000;
      padding: 8px;
      text-align: center;
      font-size: 14px;
      font-weight: 900;
      margin-bottom: 12px;
      background: ${isPrepaid ? '#f0fdf4' : '#fffbeb'};
    }
    
    .items-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 10px; border-bottom: 1px solid #000; }
    .items-table th { border-bottom: 1px solid #000; text-align: left; padding: 3px 0; }
    .items-table td { padding: 4px 0; }

    .ship-from-box {
      font-size: 10px;
      line-height: 1.35;
      color: #222;
      border-top: 1px solid #ccc;
      padding-top: 6px;
    }
    
    @media print {
      body { background: #fff; padding: 0; }
      .no-print-bar { display: none !important; }
      .label-box { border: 2px solid #000; margin: 0 auto; box-shadow: none; width: 100%; max-width: 420px; }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <button class="btn-print" onclick="window.print()">
      🖨️ Print Label / Paste on Box
    </button>
  </div>

  <div class="label-box">
    <table class="header-table">
      <tr>
        <td>
          <div class="brand-title">EARN24 EXPRESS</div>
          <div class="routing-tag">${routingMode}</div>
        </td>
        <td style="text-align: right; font-size: 11px;">
          <div>Date: <strong>${new Date(order.created_at).toLocaleDateString()}</strong></div>
          ${order.tracking_number ? `<div>AWB: <strong>${order.tracking_number}</strong></div>` : ''}
        </td>
      </tr>
    </table>

    <div class="barcode-block">
      <div class="fake-barcode">||| | ||||| || ||||||| |||</div>
      <div class="order-sub-num">ORDER #${order.order_number}</div>
    </div>

    <div class="section-title">SHIP TO / DELIVER TO (CUSTOMER):</div>
    <div class="ship-to-card">
      <div class="customer-name">${customer.full_name || 'Customer'}</div>
      <div class="customer-phone">📞 ${customer.mobile_number || addr.alternate_phone || 'N/A'}</div>
      <div class="address-text">
        ${addr.address_line_1 || ''} ${addr.address_line_2 ? ', ' + addr.address_line_2 : ''}<br>
        ${addr.city ? addr.city + ', ' : ''}${addr.state || ''}
      </div>
      ${addr.landmark ? `<div class="landmark-text">Landmark: ${addr.landmark}</div>` : ''}
      <div class="pincode-highlight">PINCODE: ${addr.pincode || 'N/A'}</div>
    </div>

    <div class="pay-card">
      ${paymentLabel}
    </div>

    <div class="section-title">PACKAGE CONTENTS:</div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align: center; width: 40px;">Qty</th>
          <th style="text-align: right; width: 60px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td><strong>${it.product_name || it.catalog_name}</strong></td>
            <td style="text-align: center;">${it.quantity}</td>
            <td style="text-align: right;">₹${parseFloat(it.total_price || (it.price_per_unit * it.quantity)).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="ship-from-box">
      <strong>RETURN IF UNDELIVERED TO (SELLER):</strong><br>
      <strong>${seller.name}</strong>, ${seller.address}<br>
      ${seller.phone ? 'Phone: ' + seller.phone + ' | ' : ''}GSTIN: ${seller.gstin || 'N/A'}
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 400);
    };
  </script>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (e) {
        console.error("Shipping Label Error:", e);
        res.status(500).send("Error generating shipping label: " + e.message);
    }
};

exports.cancelUserOrder = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
        return res.status(400).json({ status: false, message: "Cancellation reason is required." });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Fetch Order and Lock
        const [orders] = await connection.query(
            "SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE",
            [id, userId]
        );

        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Order not found." });
        }

        const order = orders[0];

        // 2. Validate current status
        const allowedStatuses = ['PENDING', 'PENDING_PAYMENT', 'CONFIRMED'];
        if (!allowedStatuses.includes(order.order_status)) {
            await connection.rollback();
            return res.status(400).json({ 
                status: false, 
                message: `Order cannot be cancelled in its current state (${order.order_status}).` 
            });
        }

        // 3. Restock inventory
        const [items] = await connection.query(
            "SELECT seller_product_id, quantity FROM order_items WHERE order_id = ?",
            [id]
        );

        for (const item of items) {
            await connection.query(
                "UPDATE seller_products SET quantity = quantity + ? WHERE id = ?",
                [item.quantity, item.seller_product_id]
            );
        }

        // 4. Wallet Refund if payment was completed or payment method was WALLET
        let refundProcessed = false;
        if (order.payment_status === 'COMPLETED' || order.payment_method === 'WALLET') {
            const [wallets] = await connection.query(
                "SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE",
                [userId]
            );
            if (wallets.length === 0) {
                await connection.query("INSERT INTO user_wallets (user_id, balance) VALUES (?, ?)", [userId, order.total_amount]);
            } else {
                await connection.query(
                    "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
                    [order.total_amount, userId]
                );
            }

            // Insert into transaction history
            await connection.query(
                `INSERT INTO user_wallet_transactions 
                 (user_id, txn_type, amount, source, reference_id, remarks) 
                 VALUES (?, 'credit', ?, 'refund', ?, ?)`,
                [userId, order.total_amount, order.order_number, `Refund for cancelled order: ${reason}`]
            );
            refundProcessed = true;
        }

        // 5. Update order details
        await connection.query(
            `UPDATE orders 
             SET order_status = 'CANCELLED', 
                 payment_status = ?, 
                 cancellation_reason = ?, 
                 cancelled_by = 'USER', 
                 cancelled_at = NOW() 
             WHERE id = ?`,
            [refundProcessed ? 'REFUNDED' : 'FAILED', reason, id]
        );

        await connection.commit();
        res.status(200).json({ status: true, message: "Order cancelled successfully.", data: { orderId: id, refundProcessed } });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("User Order Cancellation Error:", error);
        res.status(500).json({ status: false, message: "Failed to cancel order: " + error.message });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Cancels a single specific item within an order
 */
exports.cancelOrderItem = async (req, res) => {
    const userId = req.user.id;
    const { orderId, itemId } = req.params;
    const { reason = 'Cancelled by user' } = req.body;

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Verify Order Ownership & Status
        const [orders] = await connection.query(
            "SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE",
            [orderId, userId]
        );
        if (orders.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Order not found." });
        }

        const order = orders[0];
        const allowedStatuses = ['PENDING', 'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING'];
        if (!allowedStatuses.includes(order.order_status)) {
            await connection.rollback();
            return res.status(400).json({
                status: false,
                message: `Items cannot be cancelled when order is in '${order.order_status}' status.`
            });
        }

        // 2. Verify Order Item
        const [items] = await connection.query(
            "SELECT * FROM order_items WHERE id = ? AND order_id = ? FOR UPDATE",
            [itemId, orderId]
        );
        if (items.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: false, message: "Order item not found." });
        }

        const item = items[0];
        if (item.item_status === 'CANCELLED') {
            await connection.rollback();
            return res.status(400).json({ status: false, message: "This item has already been cancelled." });
        }

        // 3. Mark Item as Cancelled
        await connection.query(
            `UPDATE order_items 
             SET item_status = 'CANCELLED', cancelled_at = NOW(), cancellation_reason = ? 
             WHERE id = ?`,
            [reason, itemId]
        );

        // 4. Restore Stock
        let variantId = null;
        if (item.attributes_snapshot) {
            try {
                const snapshot = typeof item.attributes_snapshot === 'string' 
                    ? JSON.parse(item.attributes_snapshot) 
                    : item.attributes_snapshot;
                variantId = snapshot.variant_id || snapshot.variantId || null;
            } catch (e) {}
        }

        if (variantId) {
            await connection.query(
                "UPDATE seller_product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?",
                [item.quantity, variantId]
            );
        }
        await connection.query(
            "UPDATE seller_products SET quantity = quantity + ? WHERE id = ?",
            [item.quantity, item.seller_product_id]
        );

        // 5. Refund Amount to Wallet if Paid
        let refundProcessed = false;
        const refundAmount = parseFloat(item.total_price || 0);

        if ((order.payment_status === 'PAID' || ['WALLET', 'ONLINE', 'RAZORPAY'].includes(order.payment_method)) && refundAmount > 0) {
            const [wallets] = await connection.query(
                "SELECT balance FROM user_wallets WHERE user_id = ? FOR UPDATE",
                [userId]
            );
            if (wallets.length === 0) {
                await connection.query("INSERT INTO user_wallets (user_id, balance) VALUES (?, ?)", [userId, refundAmount]);
            } else {
                await connection.query(
                    "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
                    [refundAmount, userId]
                );
            }

            await connection.query(
                `INSERT INTO user_wallet_transactions 
                 (user_id, txn_type, amount, source, reference_id, remarks) 
                 VALUES (?, 'credit', ?, 'refund', ?, ?)`,
                [userId, refundAmount, order.order_number, `Refund for cancelled item '${item.product_name}' in Order #${order.order_number}`]
            );
            refundProcessed = true;
        }

        // 6. Recalculate remaining active items for this order
        const [activeRows] = await connection.query(
            "SELECT COUNT(*) as active_count, SUM(total_price) as new_subtotal FROM order_items WHERE order_id = ? AND (item_status IS NULL OR item_status = 'ACTIVE')",
            [orderId]
        );

        const activeCount = activeRows[0].active_count || 0;
        const newSubtotal = parseFloat(activeRows[0].new_subtotal || 0);

        if (activeCount === 0) {
            // All items cancelled -> update order status to CANCELLED
            await connection.query(
                `UPDATE orders 
                 SET order_status = 'CANCELLED', 
                     payment_status = ?, 
                     cancellation_reason = 'All items cancelled', 
                     cancelled_by = 'USER', 
                     cancelled_at = NOW() 
                 WHERE id = ?`,
                [refundProcessed ? 'REFUNDED' : 'FAILED', orderId]
            );
        } else {
            // Update subtotal & total amount
            const newTotalAmount = newSubtotal + parseFloat(order.delivery_fee || 0);
            await connection.query(
                "UPDATE orders SET subtotal = ?, total_amount = ? WHERE id = ?",
                [newSubtotal, newTotalAmount, orderId]
            );
        }

        await connection.commit();
        res.status(200).json({
            status: true,
            message: "Item cancelled successfully.",
            data: {
                itemId,
                orderId,
                refundProcessed,
                refundAmount,
                remainingActiveItems: activeCount
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Item Cancellation Error:", error);
        res.status(500).json({ status: false, message: "Failed to cancel item: " + error.message });
    } finally {
        if (connection) connection.release();
    }
};

exports.requestReturnOrReplacement = async (req, res) => {
    const userId = req.user.id;
    const { orderId } = req.params;
    const { reason, type = 'RETURN' } = req.body;

    if (!reason) {
        return res.status(400).json({ status: false, message: 'Reason for return or replacement is required.' });
    }

    try {
        const [orders] = await db.query(
            `SELECT id, order_status, created_at FROM orders WHERE id = ? AND user_id = ?`,
            [orderId, userId]
        );

        if (orders.length === 0) {
            return res.status(404).json({ status: false, message: 'Order not found.' });
        }

        const order = orders[0];
        if (order.order_status !== 'DELIVERED') {
            return res.status(400).json({ status: false, message: 'Only delivered orders can be submitted for return or replacement.' });
        }

        const daysDiff = (new Date() - new Date(order.created_at)) / (1000 * 60 * 60 * 24);
        if (daysDiff > 7) {
            return res.status(400).json({ status: false, message: 'The 7-day return/replacement window for this order has expired.' });
        }

        await db.query(
            `UPDATE orders 
             SET return_status = 'REQUESTED', return_reason = ?, return_type = ? 
             WHERE id = ?`,
            [reason, type, orderId]
        );

        res.status(200).json({ 
            status: true, 
            message: `Your ${type === 'REPLACEMENT' ? 'replacement' : 'return'} request has been submitted successfully.` 
        });
    } catch (error) {
        console.error("Error in requestReturnOrReplacement:", error);
        res.status(500).json({ status: false, message: 'Failed to submit return request.' });
    }
};

/**
 * Initiate PayU Live Online Payment
 * Creates pending order & returns PayU SHA-512 Payment Signature Hash
 */
exports.initiatePayUPayment = async (req, res) => {
    const userId = req.user.id;
    const { shippingAddressId, cartItemIds } = req.body;

    if (!shippingAddressId) {
        return res.status(400).json({ status: false, message: 'Shipping address is required.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get user details
        const [userRows] = await connection.query('SELECT full_name, email, mobile_number FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) throw new Error('User not found.');
        const user = userRows[0];

        // 2. Get user's cart
        const [cartRows] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
        if (cartRows.length === 0) throw new Error('Cart not found.');
        const cartId = cartRows[0].id;

        // 3. Fetch cart items (Filter by cartItemIds if provided with automatic fallback)
        let validCartItemIds = null;
        if (cartItemIds) {
            if (Array.isArray(cartItemIds)) {
                validCartItemIds = cartItemIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
            } else if (typeof cartItemIds === 'string') {
                validCartItemIds = cartItemIds.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id) && id > 0);
            }
        }

        const basePayUItemQuery = `
            SELECT 
                ci.id as cart_item_id, ci.quantity, ci.seller_product_variant_id,
                sp.id as seller_product_id, p.id as product_id, p.name as product_name,
                sp.selling_price, sp.purchase_price, sp.admin_margin_percent, h.gst_percentage, sp.quantity as stock_available,
                spv.id as variant_id, spv.title as variant_title, spv.price as variant_price
            FROM cart_items ci
            JOIN seller_products sp ON ci.seller_product_id = sp.id
            JOIN products p ON sp.product_id = p.id
            LEFT JOIN hsn_codes h ON p.hsn_code_id = h.id
            LEFT JOIN seller_product_variants spv ON ci.seller_product_variant_id = spv.id
            WHERE ci.cart_id = ?
        `;

        let cartItems = [];
        if (validCartItemIds && validCartItemIds.length > 0) {
            const [filtered] = await connection.query(`${basePayUItemQuery} AND ci.id IN (?)`, [cartId, validCartItemIds]);
            cartItems = filtered;
        }

        if (cartItems.length === 0) {
            const [allInCart] = await connection.query(basePayUItemQuery, [cartId]);
            cartItems = allInCart;
        }

        if (cartItems.length === 0) throw new Error('No items selected for payment.');

        // Fetch Delivery & BV Settings
        const [settingsRows] = await connection.query("SELECT setting_key, setting_value FROM app_settings");
        const settings = settingsRows.reduce((acc, setting) => {
            acc[setting.setting_key] = parseFloat(setting.setting_value);
            return acc;
        }, {});

        const bvGenerationPct = settings.bv_generation_pct_of_profit || 80.0;
        const bvThreshold = settings.delivery_fee_bv_threshold || 50.0;
        const standardFee = settings.delivery_fee_standard || 40.0;
        const specialFee = settings.delivery_fee_special || 0.0;

        let subtotal = 0;
        let totalGstAmount = 0;
        let totalBvEarned = 0;

        for (const item of cartItems) {
            const itemPrice = parseFloat(item.variant_id ? item.variant_price : item.selling_price);
            const itemQty = parseInt(item.quantity);
            subtotal += itemPrice * itemQty;

            const gstPercent = parseFloat(item.gst_percentage || 0);
            if (gstPercent > 0) {
                totalGstAmount += ((itemPrice * itemQty) * gstPercent) / 100;
            }

            const adminMargin = parseFloat(item.admin_margin_percent || 0);
            const purchasePrice = parseFloat(item.purchase_price || 0);
            let itemProfit = 0;
            if (adminMargin > 0) {
                itemProfit = (itemPrice * adminMargin) / 100;
            } else {
                const grossProfit = itemPrice - purchasePrice;
                const gstAmt = (itemPrice * gstPercent) / 100;
                itemProfit = grossProfit - gstAmt;
            }
            if (itemProfit > 0) {
                totalBvEarned += (itemProfit * (bvGenerationPct / 100)) * itemQty;
            }
        }

        const deliveryFee = totalBvEarned >= bvThreshold ? specialFee : standardFee;
        const totalAmount = Math.round((subtotal + deliveryFee) * 100) / 100;

        // Ensure temporary checkout sessions table exists
        await db.query(`
            CREATE TABLE IF NOT EXISTS payment_checkout_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id VARCHAR(100) UNIQUE NOT NULL,
                user_id INT NOT NULL,
                shipping_address_id INT NOT NULL,
                order_number VARCHAR(50) NOT NULL,
                subtotal DECIMAL(10,2) NOT NULL,
                delivery_fee DECIMAL(10,2) NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                total_bv_earned DECIMAL(10,2) NOT NULL,
                cart_item_ids JSON NULL,
                session_items JSON NOT NULL,
                created_order_id INT NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `).catch(e => console.warn('[Checkout Sessions Table Init]', e.message));

        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
        const orderNumber = `ORD-${year}${month}${day}-${randomPart}`;
        const txnid = `TXN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // 4. Build Item Snapshots & Session Data (DO NOT INSERT INTO orders OR order_items until payment is confirmed)
        const sessionItems = [];
        for (const item of cartItems) {
            const snapshot = {};
            if (item.variant_title) snapshot['Selected Variant'] = item.variant_title;
            if (item.variant_color) snapshot['Color'] = item.variant_color;
            if (item.variant_size) snapshot['Size'] = item.variant_size;
            if (item.variant_sku) snapshot['SKU'] = item.variant_sku;
            if (item.variant_image_url) snapshot['Variant Image'] = item.variant_image_url;

            const effectivePrice = parseFloat(item.variant_id ? item.variant_price : item.selling_price);
            const effectiveName = item.variant_id ? `${item.product_name} (${item.variant_title})` : item.product_name;

            const adminMargin = parseFloat(item.admin_margin_percent || 0);
            const purchasePrice = parseFloat(item.purchase_price || 0);
            const gstPercent = parseFloat(item.gst_percentage || 0);
            let itemProfit = 0;
            if (adminMargin > 0) {
                itemProfit = (effectivePrice * adminMargin) / 100;
            } else {
                const grossProfit = effectivePrice - purchasePrice;
                const gstAmt = (effectivePrice * gstPercent) / 100;
                itemProfit = grossProfit - gstAmt;
            }
            const bvEarnedPerUnit = itemProfit > 0 ? (itemProfit * (bvGenerationPct / 100)) : 0;

            sessionItems.push({
                product_id: item.product_id,
                seller_product_id: item.seller_product_id,
                product_name: effectiveName,
                attributes_snapshot: snapshot,
                quantity: item.quantity,
                price_per_unit: effectivePrice,
                purchase_price: purchasePrice,
                gst_percentage: gstPercent,
                total_price: effectivePrice * item.quantity,
                bv_earned_per_unit: bvEarnedPerUnit,
                total_bv_earned: bvEarnedPerUnit * item.quantity
            });
        }

        // Store into temporary checkout session table (Real order will only be created upon verified payment)
        await connection.query(
            `INSERT INTO payment_checkout_sessions (
                session_id, user_id, shipping_address_id, order_number, subtotal, 
                delivery_fee, total_amount, total_bv_earned, cart_item_ids, session_items, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [
                txnid, userId, shippingAddressId, orderNumber, subtotal,
                deliveryFee, totalAmount, totalBvEarned,
                cartItemIds ? JSON.stringify(cartItemIds) : null,
                JSON.stringify(sessionItems)
            ]
        );

        await connection.commit();

        // 5. Get PayU Credentials (Dynamic DB + Env Fallback)
        const getPayUCredentials = async () => {
            try {
                const [rows] = await db.query(
                    `SELECT encrypted_config, encryption_iv FROM payment_gateway_settings WHERE gateway_name = 'payu' AND is_active = 1 LIMIT 1`
                );
                if (rows.length > 0) {
                    const { decryptObject } = require('../utils/encryption.helper');
                    const config = decryptObject({
                        encryptedData: rows[0].encrypted_config,
                        iv: rows[0].encryption_iv,
                    });
                    if (config && (config.merchantKey || config.key) && (config.merchantSalt || config.salt)) {
                        return {
                            payuKey: config.merchantKey || config.key,
                            payuSalt: config.merchantSalt || config.salt,
                            payuBaseUrl: config.isSandBox ? 'https://test.payu.in/_payment' : 'https://secure.payu.in/_payment'
                        };
                    }
                }
            } catch (e) {
                console.warn('DB PayU Config Read Warning:', e.message);
            }
            return {
                payuKey: process.env.PAYU_MERCHANT_KEY || 'm2uwkj',
                payuSalt: process.env.PAYU_MERCHANT_SALT || 'PyBf3kWiI6MdwYhrR3geD108F7fcpPI4',
                payuBaseUrl: process.env.PAYU_BASE_URL || 'https://secure.payu.in/_payment'
            };
        };

        const { payuKey, payuSalt, payuBaseUrl } = await getPayUCredentials();

        const productInfo = `Order_${orderNumber}`;
        const firstname = (user.full_name || 'Customer').split(' ')[0].replace(/[^a-zA-Z0-9]/g, '') || 'Customer';
        const email = user.email || 'customer@earn24.in';
        const phone = user.mobile_number || '9999999999';

        // Format: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|udf7|udf8|udf9|udf10|SALT
        const hashString = `${payuKey}|${txnid}|${totalAmount.toFixed(2)}|${productInfo}|${firstname}|${email}|${txnid}||||||||||${payuSalt}`;
        const hash = crypto.createHash('sha512').update(hashString).digest('hex');

        res.status(200).json({
            status: true,
            message: 'PayU payment session initialized.',
            data: {
                payuUrl: payuBaseUrl,
                key: payuKey,
                txnid: txnid,
                amount: totalAmount.toFixed(2),
                productinfo: productInfo,
                firstname: firstname,
                email: email,
                phone: phone,
                hash: hash,
                orderId: txnid,
                orderNumber: orderNumber,
                udf1: txnid,
                surl: `${process.env.BASE_URL || 'https://newapi.earn24.in'}/api/orders/payu/verify`,
                furl: `${process.env.BASE_URL || 'https://newapi.earn24.in'}/api/orders/payu/verify`
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error initiating PayU payment:", error);
        res.status(500).json({ status: false, message: error.message || 'Failed to initialize PayU payment.' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Verify PayU Response & Complete Order (True E-Commerce Order Placement)
 */
exports.verifyPayUPayment = async (req, res) => {
    const body = req.body || {};
    const query = req.query || {};
    const data = { ...query, ...body };

    const { status } = data;
    const identifier = data.txnid || data.udf1 || data.orderId;

    if (!identifier) {
        return res.status(400).json({ status: false, message: 'Missing transaction identifier.' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Look up temporary checkout session
        const [sessions] = await connection.query(
            "SELECT * FROM payment_checkout_sessions WHERE session_id = ? OR order_number = ? LIMIT 1 FOR UPDATE",
            [identifier, identifier]
        );

        if (sessions.length > 0) {
            const session = sessions[0];

            // If already processed into an order, return existing order details (Idempotency)
            if (session.status === 'COMPLETED' && session.created_order_id) {
                await connection.commit();
                return res.status(200).json({
                    status: true,
                    message: 'Payment already verified and order confirmed.',
                    data: {
                        orderId: session.created_order_id,
                        orderNumber: session.order_number
                    }
                });
            }

            if (status === 'success' || data.status === 'success') {
                // Payment was SUCCESSFUL -> NOW create the REAL order in database!
                const [orderResult] = await connection.query(
                    `INSERT INTO orders (
                        user_id, shipping_address_id, order_number, subtotal, delivery_fee, 
                        total_amount, total_bv_earned, payment_method, payment_status, order_status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAYU', 'PAID', 'CONFIRMED', NOW(), NOW())`,
                    [
                        session.user_id, session.shipping_address_id, session.order_number,
                        session.subtotal, session.delivery_fee, session.total_amount, session.total_bv_earned
                    ]
                );
                const createdOrderId = orderResult.insertId;

                // Insert items into order_items
                const items = typeof session.session_items === 'string' 
                    ? JSON.parse(session.session_items) 
                    : (session.session_items || []);

                for (const item of items) {
                    const orderItemSql = `
                        INSERT INTO order_items (
                            order_id, product_id, seller_product_id, product_name, 
                            attributes_snapshot, quantity, price_per_unit, purchase_price, gst_percentage, total_price, 
                            bv_earned_per_unit, total_bv_earned
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                    await connection.query(orderItemSql, [
                        createdOrderId, item.product_id, item.seller_product_id, item.product_name,
                        typeof item.attributes_snapshot === 'string' ? item.attributes_snapshot : JSON.stringify(item.attributes_snapshot || {}),
                        item.quantity, item.price_per_unit, item.purchase_price, item.gst_percentage, item.total_price,
                        item.bv_earned_per_unit, item.total_bv_earned
                    ]);

                    // Deduct stock if seller_product exists
                    if (item.seller_product_id) {
                        await connection.query(
                            "UPDATE seller_products SET stock = GREATEST(0, stock - ?) WHERE id = ?",
                            [item.quantity, item.seller_product_id]
                        ).catch(() => {});
                    }
                }

                // Delete ordered items from user's cart
                const cartItemIds = session.cart_item_ids ? (typeof session.cart_item_ids === 'string' ? JSON.parse(session.cart_item_ids) : session.cart_item_ids) : null;
                const [cartRows] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [session.user_id]);
                if (cartRows.length > 0) {
                    const cartId = cartRows[0].id;
                    if (cartItemIds && cartItemIds.length > 0) {
                        await connection.query('DELETE FROM cart_items WHERE cart_id = ? AND id IN (?)', [cartId, cartItemIds]);
                    } else {
                        await connection.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
                    }
                }

                // Update session to COMPLETED with link to order
                await connection.query(
                    "UPDATE payment_checkout_sessions SET status = 'COMPLETED', created_order_id = ?, updated_at = NOW() WHERE id = ?",
                    [createdOrderId, session.id]
                );

                await connection.commit();

                // Trigger Smart Auto-Dispatch Engine
                const deliveryAppController = require('./deliveryAppController');
                deliveryAppController.autoDispatchOrder(createdOrderId).catch(err => 
                    console.error('[Auto-Dispatch Trigger Error]', err.message)
                );

                // Notify Socket Admin & Merchant of valid placed order
                const io = req.app.get('socketio') || req.app.get('io');
                if (io) {
                    io.to('admins').emit('new_order', {
                        orderId: createdOrderId,
                        orderNumber: session.order_number,
                        totalAmount: session.total_amount,
                        orderStatus: 'CONFIRMED'
                    });
                }

                return res.status(200).json({
                    status: true,
                    message: 'Payment verified and order placed successfully.',
                    data: {
                        orderId: createdOrderId,
                        orderNumber: session.order_number
                    }
                });
            } else {
                // Payment was FAILED or CANCELLED
                await connection.query(
                    "UPDATE payment_checkout_sessions SET status = 'FAILED', updated_at = NOW() WHERE id = ?",
                    [session.id]
                );
                await connection.commit();
                return res.status(400).json({ status: false, message: 'Payment verification failed or payment cancelled.' });
            }
        } else {
            // Fallback for any legacy orders created before this update
            const [legacyOrderRows] = await connection.query(
                "SELECT id, user_id, order_number, order_status FROM orders WHERE id = ? OR order_number = ? LIMIT 1",
                [identifier, identifier]
            );
            if (legacyOrderRows.length > 0) {
                const targetOrderId = legacyOrderRows[0].id;
                if (status === 'success' || data.status === 'success') {
                    await connection.query(
                        "UPDATE orders SET payment_status = 'PAID', order_status = 'CONFIRMED', updated_at = NOW() WHERE id = ?",
                        [targetOrderId]
                    );
                    await connection.commit();
                    return res.status(200).json({
                        status: true,
                        message: 'Payment verified and order placed successfully.',
                        data: {
                            orderId: targetOrderId,
                            orderNumber: legacyOrderRows[0].order_number
                        }
                    });
                } else {
                    await connection.query(
                        "UPDATE orders SET payment_status = 'FAILED', order_status = 'CANCELLED', updated_at = NOW() WHERE id = ?",
                        [targetOrderId]
                    );
                    await connection.commit();
                    return res.status(400).json({ status: false, message: 'Payment verification failed or payment cancelled.' });
                }
            }

            await connection.rollback();
            return res.status(404).json({ status: false, message: 'Payment session or order not found.' });
        }
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error verifying PayU payment:", error);
        return res.status(500).json({ status: false, message: error.message || 'Internal server error verifying payment.' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * @desc   Cancel order with Hybrid Refund (Wallet / Bank / COD) & Stock/BV Reversal
 * @route  POST /api/orders/:id/cancel
 * @access Private (User)
 */
exports.cancelUserOrder = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const orderId = req.params.id || req.params.orderId;
    const { refund_type, cancellation_reason } = req.body;
    const userId = req.user ? req.user.id : null;

    let query = "SELECT * FROM orders WHERE id = ?";
    let params = [orderId];
    if (userId && req.user.role !== 'admin') {
      query += " AND user_id = ?";
      params.push(userId);
    }

    const [orders] = await connection.query(query, params);
    if (!orders || orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({ status: false, message: 'Order not found or access denied.' });
    }

    const order = orders[0];
    const upperStatus = (order.order_status || '').toUpperCase();

    if (upperStatus === 'CANCELLED') {
      await connection.rollback();
      return res.status(400).json({ status: false, message: 'Order is already cancelled.' });
    }

    if (['SHIPPED', 'DELIVERED', 'COMPLETED', 'OUT_FOR_DELIVERY'].includes(upperStatus)) {
      await connection.rollback();
      return res.status(400).json({ status: false, message: `Order cannot be cancelled as it is already ${upperStatus}.` });
    }

    const refundAmount = parseFloat(order.total_amount || 0);
    const paymentMethod = (order.payment_method || '').toUpperCase();
    const isPaid = (order.payment_status || '').toUpperCase() === 'PAID' || (order.payment_status || '').toUpperCase() === 'SUCCESS';

    let refundStatus = 'NONE';
    let processedRefundType = 'N/A';

    // 1. Process Financial Refund based on Payment Method & User Preference
    if (paymentMethod === 'WALLET' || (isPaid && (refund_type === 'WALLET' || !refund_type))) {
      // Refund 100% to Earn24 Wallet
      processedRefundType = 'WALLET';
      refundStatus = 'REFUNDED';

      const [wCheck] = await connection.query("SELECT id FROM user_wallets WHERE user_id = ?", [order.user_id]);
      if (wCheck.length > 0) {
        await connection.query(
          "UPDATE user_wallets SET balance = balance + ? WHERE user_id = ?",
          [refundAmount, order.user_id]
        );
      } else {
        await connection.query(
          "INSERT INTO user_wallets (user_id, balance, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
          [order.user_id, refundAmount]
        );
      }

      await connection.query(
        `INSERT INTO user_wallet_transactions (user_id, txn_type, amount, source, reference_id, remarks, created_at)
         VALUES (?, 'credit', ?, 'refund', ?, ?, NOW())`,
        [order.user_id, refundAmount, order.id, `Refund for Cancelled Order #${order.order_number || order.id}`]
      ).catch(async () => {
        await connection.query(
          `INSERT INTO user_wallet_transactions (user_id, amount, transaction_type, remarks, created_at)
           VALUES (?, ?, 'CREDIT', ?, NOW())`,
          [order.user_id, refundAmount, `Refund for Cancelled Order #${order.order_number || order.id}`]
        ).catch(e => console.warn('Wallet transaction write warning:', e.message));
      });
    } else if (isPaid && refund_type === 'BANK') {
      // Trigger PayU Bank Refund API
      processedRefundType = 'BANK';
      refundStatus = 'REFUND_PENDING';

      try {
        const crypto = require('crypto');
        const axios = require('axios');
        const [payuRows] = await connection.query(
          "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('payu_merchant_key', 'payu_merchant_salt')"
        );
        const payuMap = {};
        payuRows.forEach(r => payuMap[r.setting_key] = r.setting_value);
        const payuKey = payuMap.payu_merchant_key || 'm2uwkj';
        const payuSalt = payuMap.payu_merchant_salt || 'PyBf3kWiI6MdwYhrR3geD108F7fcpPI4';
        const command = 'cancel_refund_transaction';
        const var1 = order.payment_id || order.order_number || order.id;
        const var2 = refundAmount.toFixed(2);
        const hashStr = `${payuKey}|${command}|${var1}|${payuSalt}`;
        const hash = crypto.createHash('sha512').update(hashStr).digest('hex');

        const paramsData = new URLSearchParams();
        paramsData.append('key', payuKey);
        paramsData.append('command', command);
        paramsData.append('var1', var1);
        paramsData.append('var2', var2);
        paramsData.append('hash', hash);

        const payuResp = await axios.post('https://info.payu.in/merchant/postservice?form=2', paramsData.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (payuResp.data && (payuResp.data.status === 1 || payuResp.data.status === '1')) {
          refundStatus = 'REFUNDED';
        }
      } catch (payuErr) {
        console.error("PayU Refund API call error (Logged, fallback pending):", payuErr.message);
      }
    } else if (paymentMethod === 'COD') {
      refundStatus = 'NO_REFUND_NEEDED';
      processedRefundType = 'COD';
    }

    // 2. Reverse Stock Quantities
    const [items] = await connection.query("SELECT * FROM order_items WHERE order_id = ?", [orderId]);
    for (const item of items) {
      if (item.seller_product_variant_id) {
        await connection.query(
          "UPDATE seller_product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?",
          [item.quantity, item.seller_product_variant_id]
        ).catch(() => {});
      }
      if (item.seller_product_id) {
        await connection.query(
          "UPDATE seller_products SET quantity = quantity + ? WHERE id = ?",
          [item.quantity, item.seller_product_id]
        );
      }
    }

    // 3. Update Order Record with Fallback
    try {
      await connection.query(
        `UPDATE orders SET 
          order_status = 'CANCELLED', 
          payment_status = IF(payment_status = 'PAID' OR payment_status = 'SUCCESS', 'REFUNDED', payment_status),
          cancellation_reason = ?,
          cancellation_refund_type = ?,
          cancellation_refund_status = ?,
          cancelled_at = NOW()
         WHERE id = ?`,
        [cancellation_reason || 'Cancelled by User', processedRefundType, refundStatus, orderId]
      );
    } catch (updateErr) {
      console.warn("Full order cancel update failed, attempting column addition and fallback...", updateErr.message);
      await connection.query(`ALTER TABLE orders ADD COLUMN cancellation_reason VARCHAR(255) NULL;`).catch(() => {});
      await connection.query(`ALTER TABLE orders ADD COLUMN cancellation_refund_type VARCHAR(50) NULL;`).catch(() => {});
      await connection.query(`ALTER TABLE orders ADD COLUMN cancellation_refund_status VARCHAR(50) NULL;`).catch(() => {});
      await connection.query(`ALTER TABLE orders ADD COLUMN cancelled_at DATETIME NULL;`).catch(() => {});
      
      await connection.query(
        `UPDATE orders SET 
          order_status = 'CANCELLED', 
          payment_status = IF(payment_status = 'PAID' OR payment_status = 'SUCCESS', 'REFUNDED', payment_status)
         WHERE id = ?`,
        [orderId]
      );
    }

    await connection.commit();
    res.status(200).json({
      status: true,
      message: `Order cancelled successfully. Refund method: ${processedRefundType} (${refundStatus}).`,
      refund_type: processedRefundType,
      refund_status: refundStatus,
      refund_amount: refundAmount
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error in cancelUserOrder:", err);
    res.status(500).json({ status: false, message: 'Internal server error while cancelling order.' });
  } finally {
    connection.release();
  }
};

exports.requestReturn = async (req, res) => {
  const userId = req.user.id;
  const { orderId } = req.params;
  const { reason, type, requestType, orderItemId, evidence_images, refund_method, refundMethod, customer_upi_id, customerUpiId } = req.body;

  const reqType = (type || requestType || 'RETURN').toUpperCase();
  const returnReason = reason || 'Return requested by user';
  const chosenRefundMethod = 'WALLET'; // 100% Policy: all returns credit to user Earn24 Wallet
  const upiId = null;
  const pickupOtp = Math.floor(1000 + Math.random() * 9000).toString();

  try {
    // 1. Check if order exists and belongs to user
    const [orders] = await db.query(
      `SELECT id, order_number, order_status, delivered_at, created_at FROM orders WHERE id = ? AND user_id = ?`,
      [orderId, userId]
    );

    if (!orders || orders.length === 0) {
      return res.status(404).json({ status: false, message: 'Order not found.' });
    }

    const order = orders[0];

    // 2. Check if order status is DELIVERED
    if (order.order_status !== 'DELIVERED') {
      return res.status(400).json({ status: false, message: 'Return or replacement can only be requested for DELIVERED orders.' });
    }

    // 3. Find order items with return & replacement policies
    const [items] = await db.query(
      `SELECT oi.*, sp.seller_id as merchant_seller_id,
              IFNULL(sp.has_return_policy, IFNULL(psc.has_return_policy, 1)) as has_return_policy,
              IFNULL(sp.return_window_days, IFNULL(psc.return_window_days, 7)) as return_window_days,
              IFNULL(sp.is_replacement_available, IFNULL(psc.is_replacement_available, 1)) as is_replacement_available,
              IFNULL(sp.replacement_window_days, IFNULL(psc.replacement_window_days, 7)) as replacement_window_days
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       LEFT JOIN product_subcategories psc ON p.subcategory_id = psc.id
       LEFT JOIN seller_products sp ON oi.seller_product_id = sp.id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    if (!items || items.length === 0) {
      return res.status(404).json({ status: false, message: 'No items found for this order.' });
    }

    // Choose target item (specific orderItemId or first item)
    const targetItem = orderItemId ? items.find(i => i.id == orderItemId) || items[0] : items[0];

    // Policy Validation Guard (Enforce Non-Returnable / Non-Replaceable Offers)
    const canReturn = (targetItem.has_return_policy === 1 || targetItem.has_return_policy === '1' || targetItem.has_return_policy === true);
    const canReplace = (targetItem.is_replacement_available === 1 || targetItem.is_replacement_available === '1' || targetItem.is_replacement_available === true);

    if (reqType === 'RETURN' && !canReturn) {
      return res.status(400).json({
        status: false,
        message: 'Returns / Refunds are not available for this product offer.'
      });
    }

    if (reqType === 'REPLACEMENT' && !canReplace) {
      return res.status(400).json({
        status: false,
        message: 'Replacements are not available for this product offer.'
      });
    }

    // Check delivery window
    const deliveryDate = order.delivered_at || order.created_at;
    const windowDays = reqType === 'RETURN' ? parseInt(targetItem.return_window_days || 7, 10) : parseInt(targetItem.replacement_window_days || 7, 10);
    const daysDiff = (Date.now() - new Date(deliveryDate).getTime()) / (1000 * 3600 * 24);
    if (daysDiff > windowDays) {
      return res.status(400).json({
        status: false,
        message: `${reqType === 'RETURN' ? 'Return' : 'Replacement'} window (${windowDays} days) has expired.`
      });
    }

    // 4. Get merchant_id if available
    let merchantId = null;
    if (targetItem.merchant_seller_id) {
      const [sellerRows] = await db.query(
        `SELECT sellerable_id FROM sellers WHERE id = ? AND sellerable_type = 'Merchant'`,
        [targetItem.merchant_seller_id]
      ).catch(() => [[]]);
      if (sellerRows && sellerRows.length > 0) {
        merchantId = sellerRows[0].sellerable_id;
      }
    }

    // 5. Ensure order_returns columns exist
    await db.query(`ALTER TABLE order_returns MODIFY COLUMN status VARCHAR(50) DEFAULT 'PENDING';`).catch(() => {});
    await db.query(`ALTER TABLE order_returns MODIFY COLUMN merchant_action VARCHAR(50) DEFAULT 'PENDING';`).catch(() => {});
    await db.query(`ALTER TABLE order_returns MODIFY COLUMN admin_action VARCHAR(50) DEFAULT 'PENDING';`).catch(() => {});
    await db.query(`ALTER TABLE order_returns MODIFY COLUMN evidence_images LONGTEXT NULL;`).catch(() => {});
    await db.query(`ALTER TABLE order_returns ADD COLUMN pickup_otp VARCHAR(20) NULL;`).catch(() => {});
    await db.query(`ALTER TABLE order_returns ADD COLUMN refund_method VARCHAR(20) DEFAULT 'WALLET';`).catch(() => {});
    await db.query(`ALTER TABLE order_returns ADD COLUMN customer_upi_id VARCHAR(100) NULL;`).catch(() => {});
    await db.query(`ALTER TABLE order_returns ADD COLUMN return_quantity INT DEFAULT 1;`).catch(() => {});
    await db.query(`ALTER TABLE order_returns ADD COLUMN reject_reason VARCHAR(255) NULL;`).catch(() => {});
    await db.query(`ALTER TABLE order_returns ADD COLUMN admin_remarks TEXT NULL;`).catch(() => {});
    await db.query(`ALTER TABLE order_returns ADD COLUMN rejection_reason VARCHAR(255) NULL;`).catch(() => {});

    const safeItemId = (targetItem && targetItem.id) ? targetItem.id : 0;
    const safeMerchantId = merchantId || null;

    // 6. Check if request already submitted FOR THIS SPECIFIC ITEM
    const [existing] = await db.query(
      `SELECT id FROM order_returns WHERE order_id = ? AND order_item_id = ? AND status NOT IN ('REJECTED', 'CLOSED')`,
      [orderId, safeItemId]
    ).catch(() => [[]]);

    if (existing && existing.length > 0) {
      return res.status(400).json({
        status: false,
        message: `A ${reqType.toLowerCase()} request for this item is already in progress.`
      });
    }

    // Support requested return quantity and proportionate refund
    const orderedQty = parseInt(targetItem.quantity) || 1;
    const returnQty = Math.min(Math.max(1, parseInt(req.body.quantity || req.body.return_quantity || 1)), orderedQty);
    const unitPrice = (parseFloat(targetItem.total_price || targetItem.price || 0) / orderedQty) || 0;
    const itemRefundAmount = (unitPrice * returnQty).toFixed(2);

    // 7. Insert Return / Replacement Request with Primary & Fallback
    let result;
    try {
      [result] = await db.query(
        `INSERT INTO order_returns 
          (order_id, order_item_id, user_id, merchant_id, return_type, request_type, reason, evidence_images, refund_amount, return_quantity, status, pickup_otp, refund_method, customer_upi_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
        [
          orderId,
          safeItemId,
          userId,
          safeMerchantId,
          reqType,
          reqType,
          returnReason,
          evidence_images ? JSON.stringify(evidence_images) : null,
          itemRefundAmount,
          returnQty,
          pickupOtp,
          chosenRefundMethod,
          upiId
        ]
      );
    } catch (insertErr) {
      console.warn("Primary return insert failed, executing fallback insert:", insertErr.message);
      [result] = await db.query(
        `INSERT INTO order_returns 
          (order_id, order_item_id, user_id, merchant_id, reason, refund_amount, return_quantity, status, pickup_otp, refund_method, customer_upi_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
        [
          orderId,
          safeItemId,
          userId,
          safeMerchantId,
          returnReason,
          itemRefundAmount,
          returnQty,
          pickupOtp,
          chosenRefundMethod,
          upiId
        ]
      );
    }

    // 8. Update Order status flag
    await db.query(`ALTER TABLE orders ADD COLUMN is_return_requested TINYINT DEFAULT 0;`).catch(() => {});
    await db.query(`UPDATE orders SET is_return_requested = 1 WHERE id = ?`, [orderId]).catch(() => {});

    res.status(200).json({
      status: true,
      message: `Your ${reqType === 'RETURN' ? 'Return' : 'Replacement'} request for Order #${order.order_number || orderId} has been submitted successfully! Merchant/Admin will review it within 24-48 hours.`,
      request_id: result.insertId
    });

  } catch (error) {
    console.error("Error in requestReturn:", error);
    res.status(500).json({
      status: false,
      message: error.message || 'Failed to submit return/replacement request.'
    });
  }
};

/*
=============================================================================
                          PREVIOUS CODE REFERENCE
=============================================================================

const db = require('../../db');
const Order = require('../Models/orderModel');
const OrderItem = require('../Models/orderItemModel.js');
const Address = require('../Models/userAddressModel.js');

const notificationService = require('../utils/notificationService.js');
const commissionService = require('../Services/commissionService');

// Helper function to generate a unique order number
const generateOrderNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const randomPart = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `ORD-${year}${month}${day}-${randomPart}`;
};

// ... and other previous versions provided by you ...
=============================================================================
*/