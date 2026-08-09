const axios = require('axios');

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

let cachedToken = null;
let tokenExpiryTime = 0;

/**
 * Authenticates with Shiprocket API to retrieve a Bearer token.
 */
async function getAuthToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiryTime) {
        return cachedToken;
    }

    const email = process.env.SHIPROCKET_EMAIL;
    const password = process.env.SHIPROCKET_PASSWORD;

    if (!email || !password) {
        // Fallback for development/testing if environment variables are not set yet
        console.warn("⚠️ SHIPROCKET_EMAIL or SHIPROCKET_PASSWORD not configured in .env. Using mock mode.");
        return "MOCK_SHIPROCKET_TOKEN";
    }

    try {
        const response = await axios.post(`${SHIPROCKET_BASE_URL}/auth/login`, {
            email,
            password
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
        console.error("Error authenticating with Shiprocket API:", error.response?.data || error.message);
        throw error;
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
                width,
                height
            }
        });

        const data = response.data?.data;
        if (data && data.available_courier_companies && data.available_courier_companies.length > 0) {
            // Pick the lowest rate courier
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

/**
 * Creates an ad-hoc pickup shipment in Shiprocket.
 */
async function createForwardOrder(orderPayload) {
    try {
        const token = await getAuthToken();
        if (token === "MOCK_SHIPROCKET_TOKEN") {
            const mockAwb = "AWB" + Math.floor(100000000 + Math.random() * 900000000);
            return {
                success: true,
                shipment_id: "SHIP_" + Date.now(),
                awb_code: mockAwb,
                courier_name: "Mock Delhivery Express"
            };
        }

        const response = await axios.post(`${SHIPROCKET_BASE_URL}/orders/create/adhoc`, orderPayload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        return {
            success: true,
            order_id: response.data.order_id,
            shipment_id: response.data.shipment_id,
            awb_code: response.data.awb_code
        };
    } catch (error) {
        console.error("Shiprocket Create Order Error:", error.response?.data || error.message);
        throw error;
    }
}

module.exports = {
    getAuthToken,
    checkServiceability,
    createForwardOrder
};
