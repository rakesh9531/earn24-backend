const axios = require('axios');
require('dotenv').config();

const PAYU_PAYOUT_CLIENT_ID = process.env.PAYU_PAYOUT_CLIENT_ID;
const PAYU_PAYOUT_CLIENT_SECRET = process.env.PAYU_PAYOUT_CLIENT_SECRET;
const PAYU_PAYOUT_ENV = process.env.PAYU_PAYOUT_ENV || 'sandbox';

const BASE_URL = PAYU_PAYOUT_ENV === 'production'
  ? 'https://payouts.payu.in'
  : 'https://payouts-sandbox.payu.in';

/**
 * Get Access Token from PayU Payout API
 */
async function getAccessToken() {
    if (!PAYU_PAYOUT_CLIENT_ID || !PAYU_PAYOUT_CLIENT_SECRET) {
        if (PAYU_PAYOUT_ENV === 'sandbox') {
            console.log('[PayU Payouts Mock] Client ID or Client Secret missing. Operating in Mock mode.');
            return 'MOCK_TOKEN';
        }
        throw new Error('PayU Payout Client ID and Client Secret are required in production.');
    }

    try {
        const response = await axios.post(
            `${BASE_URL}/oauth/token`,
            new URLSearchParams({
                client_id: PAYU_PAYOUT_CLIENT_ID,
                client_secret: PAYU_PAYOUT_CLIENT_SECRET,
                grant_type: 'client_credentials'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data && response.data.access_token) {
            return response.data.access_token;
        } else {
            throw new Error('Access token not found in authentication response.');
        }
    } catch (error) {
        console.error('PayU Payout Authentication failed:', error.response?.data || error.message);
        throw new Error(`Authentication with PayU failed: ${error.response?.data?.message || error.message}`);
    }
}

/**
 * Process a payout bank transfer
 */
exports.processPayout = async ({ requestId, amount, bankDetails }) => {
    const token = await getAccessToken();

    if (token === 'MOCK_TOKEN') {
        const mockUtr = 'MOCKUTR' + Math.floor(100000000000 + Math.random() * 900000000000);
        console.log(`[PayU Payouts Mock] Payout simulation successful for request ID ${requestId}. Generated UTR: ${mockUtr}`);
        return {
            status: 'SUCCESS',
            utr: mockUtr,
            message: 'Mock payout simulation successful.'
        };
    }

    try {
        const payload = {
            merchantRefId: `WITHDRAW_${requestId}`,
            amount: parseFloat(amount),
            paymentMode: 'IMPS', // IMPS is default for instant payouts
            beneficiaryDetails: {
                beneficiaryName: bankDetails.bank_account_holder_name,
                accountNumber: bankDetails.bank_account_number,
                ifscCode: bankDetails.bank_ifsc_code
            }
        };

        const response = await axios.post(
            `${BASE_URL}/api/v1/transfers`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const data = response.data;
        console.log(`[PayU Payout] API Response for Request ID ${requestId}:`, JSON.stringify(data));

        if (data && (data.status === 'SUCCESS' || data.statusCode === 'SUCCESS' || data.status === 'success')) {
            return {
                status: 'SUCCESS',
                utr: data.utr || data.data?.utr || `PAYU_${Date.now()}`,
                message: data.message || 'Transfer successful'
            };
        } else if (data && (data.status === 'PENDING' || data.status === 'PROCESSING' || data.status === 'pending' || data.status === 'processing')) {
            return {
                status: 'PENDING',
                message: data.message || 'Transfer is pending processing'
            };
        } else {
            return {
                status: 'FAILED',
                message: data.message || data.errorMessage || 'Transfer failed'
            };
        }

    } catch (error) {
        console.error(`PayU Payout Transfer Error for Request ID ${requestId}:`, error.response?.data || error.message);
        const errMsg = error.response?.data?.message || error.response?.data?.errorMessage || error.message;
        return {
            status: 'FAILED',
            message: `API Transfer request error: ${errMsg}`
        };
    }
};
