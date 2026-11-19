const db = require('../../db');

exports.renderProductShare = async (req, res) => {
    try {
        const productId = req.params.id;
        if (!productId) {
            return res.redirect('https://play.google.com/store/apps/details?id=com.earn24.app');
        }

        const [products] = await db.query(
            `SELECT p.id, p.name, p.description, p.main_image_url,
                    IFNULL(sp.selling_price, 0) as selling_price,
                    IFNULL(sp.mrp, 0) as mrp
             FROM products p
             LEFT JOIN seller_products sp ON p.id = sp.product_id AND sp.is_active = 1
             WHERE p.id = ? AND p.is_deleted = 0
             ORDER BY sp.selling_price ASC LIMIT 1`,
            [productId]
        );

        if (products.length === 0) {
            return res.redirect('https://play.google.com/store/apps/details?id=com.earn24.app');
        }

        const product = products[0];
        const rawName = product.name || 'EARN24 Product';
        const productName = rawName.replace(/"/g, '&quot;');
        const sellingPrice = parseFloat(product.selling_price || 0);
        const mrp = parseFloat(product.mrp || 0);
        const priceText = sellingPrice > 0 ? ('₹' + sellingPrice.toFixed(2)) : '';
        const mrpText = mrp > sellingPrice ? ('₹' + mrp.toFixed(2)) : '';

        let imageUrl = product.main_image_url || '';
        if (imageUrl && !imageUrl.startsWith('http')) {
            const baseUrl = (process.env.BASE_URL || 'https://newapi.earn24.in').replace(/\/+$/, '');
            imageUrl = baseUrl + (imageUrl.startsWith('/') ? '' : '/') + imageUrl;
        }
        if (!imageUrl) {
            imageUrl = 'https://earn24.in/assets/logo.png';
        }

        const deepLink = 'earn24://product/' + productId;
        const playStoreUrl = 'https://play.google.com/store/apps/details?id=com.earn24.app';
        const pageUrl = 'https://newapi.earn24.in/share/product/' + productId;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${productName} | EARN24</title>

    <!-- Open Graph for WhatsApp, Telegram, Facebook -->
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="EARN24" />
    <meta property="og:title" content="${productName}${priceText ? ' - ' + priceText : ''}" />
    <meta property="og:description" content="Shop ${productName} on EARN24 App! Get best prices, instant cashback, and fast delivery." />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:secure_url" content="${imageUrl}" />
    <meta property="og:image:width" content="600" />
    <meta property="og:image:height" content="600" />
    <meta property="og:url" content="${pageUrl}" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${productName}${priceText ? ' - ' + priceText : ''}" />
    <meta name="twitter:description" content="Shop on EARN24 App to get cashback & rewards!" />
    <meta name="twitter:image" content="${imageUrl}" />

    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        body { background: #f3f4f6; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }
        .card { background: #ffffff; max-width: 420px; width: 100%; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); text-align: center; }
        .img-box { width: 100%; height: 280px; background: #fafafa; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .img-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .content { padding: 24px 20px; }
        .brand { font-size: 13px; font-weight: 700; color: #059669; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
        .title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 12px; line-height: 1.4; }
        .price-box { margin-bottom: 24px; }
        .price { font-size: 26px; font-weight: 800; color: #059669; }
        .mrp { font-size: 16px; color: #9ca3af; text-decoration: line-through; margin-left: 8px; }
        .btn { display: block; width: 100%; padding: 14px 20px; border-radius: 12px; font-size: 16px; font-weight: 700; text-decoration: none; cursor: pointer; transition: 0.2s; margin-bottom: 12px; }
        .btn-primary { background: #059669; color: #ffffff; }
        .btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
        .footer-note { font-size: 12px; color: #9ca3af; margin-top: 8px; }
    </style>

    <script>
        (function() {
            var deepLink = "${deepLink}";
            var playStore = "${playStoreUrl}";

            var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            if (isMobile) {
                window.location.href = deepLink;
                setTimeout(function() {
                    window.location.href = playStore;
                }, 2000);
            }
        })();
    </script>
</head>
<body>
    <div class="card">
        <div class="img-box">
            <img src="${imageUrl}" alt="${productName}" />
        </div>
        <div class="content">
            <div class="brand">EARN24</div>
            <h1 class="title">${productName}</h1>
            <div class="price-box">
                <span class="price">${priceText}</span>
                ${mrpText ? '<span class="mrp">' + mrpText + '</span>' : ''}
            </div>

            <a href="${deepLink}" class="btn btn-primary">🚀 Open in EARN24 App</a>
            <a href="${playStoreUrl}" class="btn btn-secondary">📲 Download App on Play Store</a>
            <p class="footer-note">Shop on EARN24 App to get cashback & fast delivery.</p>
        </div>
    </div>
</body>
</html>`;

        return res.status(200).send(html);
    } catch (error) {
        console.error('[Product Share Error]:', error);
        return res.redirect('https://play.google.com/store/apps/details?id=com.earn24.app');
    }
};
