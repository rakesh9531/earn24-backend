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





module.exports = router