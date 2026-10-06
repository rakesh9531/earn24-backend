const axios = require('axios');
const moment = require('moment');

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

let cachedToken = null;
let tokenExpiryTime = 0;

/**
 * Retrieves Shiprocket credentials from environment variables or app_settings in the database.
 */
async function getCredentials() {
    let email = process.env.SHIPROCKET_EMAIL;
    let password = process.env.SHIPROCKET_PASSWORD;

    if (!email || !password) {
        try {
            const db = require('../../db');
            const [rows] = await db.query(
                "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('shiprocket_email', 'shiprocket_password')"
            ).catch(() => [[]]);

            if (rows && rows.length > 0) {
                for (const r of rows) {
                    if (r.setting_key === 'shiprocket_email' && r.setting_value) {
                        email = String(r.setting_value).trim();
                    }
                    if (r.setting_key === 'shiprocket_password' && r.setting_value) {
                        password = String(r.setting_value).trim();
                    }
                }
            }
        } catch (dbErr) {
            // DB fallback failed
        }
    }

    return { email, password };
}

/**
 * Authenticates with Shiprocket API to retrieve a Bearer token.
 */
async function getAuthToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiryTime) {
        return cachedToken;
    }

    // 1. Direct Bearer token from .env or DB (Bypasses login & avoids rate-limit/blocking)
    let staticToken = process.env.SHIPROCKET_TOKEN;
    if (!staticToken) {
        try {
            const db = require('../../db');
            const [rows] = await db.query(
                "SELECT setting_value FROM app_settings WHERE setting_key = 'shiprocket_token'"
            ).catch(() => [[]]);
            if (rows && rows[0] && rows[0].setting_value) {
                staticToken = String(rows[0].setting_value).trim();
            }
        } catch (e) {}
    }

    if (staticToken) {
        console.log(`[Shiprocket] Using pre-configured Bearer token.`);
        cachedToken = staticToken;
        tokenExpiryTime = now + (30 * 24 * 60 * 60 * 1000);
        return cachedToken;
    }

    const { email, password } = await getCredentials();

    if (!email || !password) {
        if (process.env.NODE_ENV === 'test') {
            return "MOCK_SHIPROCKET_TOKEN";
        }
        throw new Error("Shiprocket credentials are not configured. Please set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD (or SHIPROCKET_TOKEN) in server .env or Admin Settings.");
    }

    try {
        console.log(`[Shiprocket] Logging in with email: ${email}`);
        const response = await axios.post(`${SHIPROCKET_BASE_URL}/auth/login`, {
            email,
            password
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        });

        if (response.data && response.data.token) {
            cachedToken = response.data.token;
            // Token is typically valid for 10 days; cache for 9 days
            tokenExpiryTime = now + (9 * 24 * 60 * 60 * 1000);
            return cachedToken;
        } else {
            throw new Error("Shiprocket auth token missing in response");
        }
    } catch (error) {
        let errDetail = error.message;
        if (error.response?.data) {
            errDetail = typeof error.response.data === 'string' 
                ? error.response.data 
                : JSON.stringify(error.response.data);
        }
        console.error("Error authenticating with Shiprocket API:", errDetail);
        throw new Error(`Shiprocket Authentication Failed: ${errDetail}`);
    }
}

/**
 * Checks courier serviceability and shipping rates.
 */
async function checkServiceability(pickupPincode, deliveryPincode, weightKg = 0.5, length = 10, width = 10, height = 10) {
    try {
        const token = await getAuthToken();
        if (token === "MOCK_SHIPROCKET_TOKEN") {
            return {
                status: 200,
                success: true,
                courier_name: "Mock Delhivery Surface",
                rate: 45.00,
                estimated_days: 3
            };
        }

        const response = await axios.get(`${SHIPROCKET_BASE_URL}/courier/serviceability/`, {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                pickup_postcode: pickupPincode,
                delivery_postcode: deliveryPincode,
                weight: weightKg,
                cod: 0,
                length,
                breadth: width,
                height
            },
            timeout: 15000
        });

        const data = response.data?.data;
        if (data && data.available_courier_companies && data.available_courier_companies.length > 0) {
            const bestCourier = data.available_courier_companies.reduce((prev, curr) => (prev.rate < curr.rate) ? prev : curr);
            return {
                status: 200,
                success: true,
                courier_name: bestCourier.courier_name,
                rate: parseFloat(bestCourier.rate),
                estimated_days: bestCourier.estimated_delivery_days
            };
        }

        return { success: false, rate: 60.00, courier_name: "Standard Surface Courier", estimated_days: 4 };
    } catch (error) {
        console.error("Shiprocket Serviceability Error:", error.response?.data || error.message);
        return { success: false, rate: 50.00, courier_name: "Fallback Courier", estimated_days: 4 };
    }
}

let cachedPickupLocation = null;
let pickupLocationCacheTime = 0;

/**
 * Fetches the registered pickup location nickname from Shiprocket.
 * Defaults to "warehouse" or configured env variable.
 */
async function getPrimaryPickupLocation(token) {
    const now = Date.now();
    if (cachedPickupLocation && (now - pickupLocationCacheTime < 3600000)) {
        return cachedPickupLocation;
    }
    try {
        const authToken = token || await getAuthToken();
        const response = await axios.get(`${SHIPROCKET_BASE_URL}/settings/company/pickup`, {
            headers: { Authorization: `Bearer ${authToken}` },
            timeout: 10000
        });
        const locations = response.data?.data?.shipping_address || response.data?.shipping_address || [];
        if (Array.isArray(locations) && locations.length > 0) {
            const primary = locations.find(l => l.is_primary_location === 1) || locations[0];
            if (primary && primary.pickup_location) {
                cachedPickupLocation = primary.pickup_location;
                pickupLocationCacheTime = now;
                console.log(`[Shiprocket] Resolved primary pickup location: "${cachedPickupLocation}"`);
                return cachedPickupLocation;
            }
        }
    } catch (err) {
        console.error("[Shiprocket] Could not fetch pickup locations:", err.message);
    }
    return process.env.SHIPROCKET_PICKUP_LOCATION || "warehouse";
}

/**
 * Creates an ad-hoc pickup shipment in Shiprocket.
 * Adheres strictly to Shiprocket API specification (/orders/create/adhoc).
 */
async function createForwardOrder(orderPayload) {
    let cleanPayload = null;
    try {
        const token = await getAuthToken();
        if (token === "MOCK_SHIPROCKET_TOKEN") {
            const mockAwb = "AWB" + Math.floor(100000000 + Math.random() * 900000000);
            return {
                success: true,
                order_id: "MOCK_ORD_" + Date.now(),
                shipment_id: "SHIP_" + Date.now(),
                awb_code: mockAwb,
                courier_name: "Mock Delhivery Express"
            };
        }

        // 1. Format order date strictly as YYYY-MM-DD HH:mm (Shiprocket standard)
        let formattedDate = moment().format('YYYY-MM-DD HH:mm');
        if (orderPayload.order_date) {
            const parsed = moment(orderPayload.order_date);
            if (parsed.isValid()) {
                formattedDate = parsed.format('YYYY-MM-DD HH:mm');
            }
        }

        // 2. Parse First Name and Last Name
        const rawName = String(orderPayload.billing_customer_name || 'Customer').trim();
        const nameParts = rawName.split(/\s+/);
        const firstName = nameParts[0] || 'Customer';
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Customer';

        // 3. Resolve Pickup Location dynamically
        let resolvedPickup = String(orderPayload.pickup_location || "").trim();
        if (!resolvedPickup || resolvedPickup.toLowerCase() === 'primary') {
            resolvedPickup = await getPrimaryPickupLocation(token);
        }

        // 4. Normalize and validate phone number (Must be 10 digits starting with 6-9 for India)
        let cleanPhone = String(orderPayload.billing_phone || "").replace(/[^0-9]/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
            console.warn(`[Shiprocket] Phone "${cleanPhone}" is invalid for Indian courier. Falling back to default contact.`);
            cleanPhone = "7323952235";
        }

        // 5. Normalize items
        const rawItems = Array.isArray(orderPayload.order_items) && orderPayload.order_items.length > 0
            ? orderPayload.order_items
            : [{ name: "Catalog Items", sku: "EARN24-PROD", units: 1, selling_price: parseFloat(orderPayload.sub_total || 100) }];

        const cleanItems = rawItems.map(it => ({
            name: String(it.name || "Catalog Product").substring(0, 100),
            sku: String(it.sku || `SKU-${Date.now()}`).substring(0, 50),
            units: parseInt(it.units || 1, 10),
            selling_price: parseFloat(it.selling_price || it.price_per_unit || 0),
            discount: parseFloat(it.discount || 0),
            tax: parseFloat(it.tax || 0),
            hsn: it.hsn ? parseInt(it.hsn, 10) : undefined
        }));

        // 6. Dimensions and weight (Shiprocket requires length, breadth, height, weight)
        const length = parseFloat(orderPayload.length || 10);
        const breadth = parseFloat(orderPayload.breadth || orderPayload.width || 10);
        const height = parseFloat(orderPayload.height || 10);
        const weight = Math.max(0.1, parseFloat(orderPayload.weight || 0.5));

        // 7. Clean and sanitize Address fields (Shiprocket strictly requires combined address length >= 3)
        let addr1 = String(orderPayload.billing_address || "").trim();
        let addr2 = String(orderPayload.billing_address_2 || "").trim();
        if ((addr1 + addr2).length < 3) {
            addr1 = addr1.length > 0 ? `${addr1}, Near Main Road` : "Delivery Address, Main Road";
        }

        let cleanCity = String(orderPayload.billing_city || "").trim();
        if (cleanCity.length < 2) cleanCity = "Dhanbad";

        let cleanState = String(orderPayload.billing_state || "").trim();
        if (cleanState.length < 2) cleanState = "Jharkhand";

        let cleanPincode = String(orderPayload.billing_pincode || "").trim().replace(/\D/g, '').slice(-6);
        if (cleanPincode.length !== 6) cleanPincode = "828207";

        cleanPayload = {
            order_id: String(orderPayload.order_id).substring(0, 50),
            order_date: formattedDate,
            pickup_location: resolvedPickup.substring(0, 36),
            billing_customer_name: firstName.substring(0, 50),
            billing_last_name: lastName.substring(0, 50),
            billing_address: addr1.substring(0, 200),
            billing_address_2: addr2 ? addr2.substring(0, 200) : "",
            billing_city: cleanCity.substring(0, 50),
            billing_pincode: cleanPincode,
            billing_state: cleanState.substring(0, 50),
            billing_country: "India",
            billing_email: orderPayload.billing_email || "support@earn24.in",
            billing_phone: cleanPhone,
            shipping_is_billing: true,
            order_items: cleanItems,
            payment_method: String(orderPayload.payment_method || "Prepaid").toUpperCase() === "COD" ? "COD" : "Prepaid",
            sub_total: parseFloat(orderPayload.sub_total || 0),
            length,
            breadth,
            height,
            weight
        };

        console.log(`[Shiprocket] Calling /orders/create/adhoc for Order #${cleanPayload.order_id} (Pickup: ${cleanPayload.pickup_location})...`);

        const response = await axios.post(`${SHIPROCKET_BASE_URL}/orders/create/adhoc`, cleanPayload, {
            headers: { 
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 25000
        });

        const resData = response.data;

        // STRICT VALIDATION: Check if Shiprocket actually created the order
        if (!resData.shipment_id && !resData.order_id) {
            const errDetail = resData.message || (typeof resData.data === 'string' ? resData.data : JSON.stringify(resData.data)) || "Shiprocket rejected order creation.";
            console.error(`[Shiprocket] ❌ Order #${cleanPayload.order_id} rejected by Shiprocket:`, errDetail);
            throw new Error(`Shiprocket rejected order: ${errDetail}`);
        }

        console.log(`[Shiprocket] ✅ Order #${cleanPayload.order_id} created successfully! Shipment ID: ${resData.shipment_id}, AWB: ${resData.awb_code || 'Pending'}`);

        return {
            success: true,
            order_id: resData.order_id,
            shipment_id: resData.shipment_id,
            awb_code: resData.awb_code || null,
            courier_name: resData.courier_name || 'Shiprocket Express',
            status: resData.status,
            raw: resData
        };
    } catch (error) {
        let errorMsg = error.message;
        if (error.response?.data) {
            const data = error.response.data;
            if (typeof data === 'string') {
                errorMsg = data;
            } else if (data.message && typeof data.message === 'string') {
                errorMsg = data.message;
            } else if (data.errors) {
                if (typeof data.errors === 'string') {
                    errorMsg = data.errors;
                } else if (typeof data.errors === 'object') {
                    errorMsg = Object.entries(data.errors)
                        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                        .join(' | ');
                }
            }
        }

        // Automatic Self-Healing Retry: If pickup location is invalid, fetch actual primary location and retry
        if (errorMsg.includes('Wrong Pickup location') || errorMsg.includes('Pickup location')) {
            try {
                const verifiedPrimary = await getPrimaryPickupLocation(null);
                if (verifiedPrimary && verifiedPrimary !== cleanPayload.pickup_location) {
                    console.warn(`[Shiprocket] Retrying Order #${cleanPayload.order_id} with verified primary pickup location "${verifiedPrimary}"...`);
                    cleanPayload.pickup_location = verifiedPrimary;
                    const retryRes = await axios.post(`${SHIPROCKET_BASE_URL}/orders/create/adhoc`, cleanPayload, {
                        headers: { 
                            Authorization: `Bearer ${await getAuthToken()}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 25000
                    });
                    const resData = retryRes.data;
                    if (resData.shipment_id || resData.order_id) {
                        console.log(`[Shiprocket] ✅ Order #${cleanPayload.order_id} created successfully on retry! Shipment ID: ${resData.shipment_id}`);
                        return {
                            success: true,
                            order_id: resData.order_id,
                            shipment_id: resData.shipment_id,
                            awb_code: resData.awb_code || null,
                            courier_name: resData.courier_name || 'Shiprocket Express',
                            status: resData.status,
                            raw: resData
                        };
                    }
                }
            } catch (retryErr) {
                console.error("[Shiprocket Retry Error]:", retryErr.message);
            }
        }

        console.error("Shiprocket Create Order Error:", errorMsg, error.response?.data || error.message);
        throw new Error(errorMsg);
    }
}

module.exports = {
    getAuthToken,
    checkServiceability,
    createForwardOrder
};
