const axios = require('axios');

/**
 * SMS Multi-Provider Router Helper
 * Supports MOCK, 2FACTOR, and TWILIO based on process.env.SMS_PROVIDER
 */
exports.sendSms = async (mobileNumber, otp) => {
    const provider = (process.env.SMS_PROVIDER || 'MOCK').toUpperCase();
    console.log(`[SMS Helper] Routing OTP via Provider: ${provider}`);

    try {
        // 10-digit number cleanup
        const cleanNumber = mobileNumber.toString().replace(/\D/g, '');

        if (provider === 'MOCK') {
            // --- MOCK / TESTING MODE ---
            console.log("=================================================");
            console.log(`[MOCK SMS] Sending OTP to ${cleanNumber}`);
            console.log(`[MOCK SMS] OTP CODE: ${otp}`);
            console.log("=================================================");
            return true;
        }

        if (provider === '2FACTOR') {
            // --- 2FACTOR INTEGRATION ---
            const apiKey = process.env.TWO_FACTOR_API_KEY;
            if (!apiKey) {
                console.error("[SMS Helper] Error: TWO_FACTOR_API_KEY is not defined in .env file.");
                return false;
            }
            const templateName = process.env.TWO_FACTOR_TEMPLATE_NAME || 'DeliveryOTP';
            const url = `https://2factor.in/API/V1/${apiKey}/SMS/${cleanNumber}/${otp}/${templateName}`;
            
            console.log(`[SMS Helper] Calling 2Factor for ${cleanNumber}...`);
            const response = await axios.get(url);

            if (response.data.Status === 'Success') {
                console.log(`[2Factor Success] OTP sent to ${cleanNumber}. Reference ID: ${response.data.Details}`);
                return true;
            } else {
                console.error("[2Factor Failed] API response:", response.data);
                return false;
            }
        }

        if (provider === 'TWILIO') {
            // --- TWILIO REST API INTEGRATION ---
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

            if (!accountSid || !authToken || !twilioNumber) {
                console.error("[SMS Helper] Error: Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) are missing in .env file.");
                return false;
            }

            const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

            // Basic Auth header format
            const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

            // Twilio expects URL encoded parameters
            // Ensure number includes international format if needed (+91 for India)
            const formattedNumber = cleanNumber.startsWith('+') ? cleanNumber : `+91${cleanNumber}`;
            const requestBody = new URLSearchParams({
                From: twilioNumber,
                To: formattedNumber,
                Body: `Your Earn24 OTP code is ${otp}. Please do not share this code with anyone.`
            });

            console.log(`[SMS Helper] Calling Twilio API for ${formattedNumber}...`);
            const response = await axios.post(url, requestBody.toString(), {
                headers: {
                    'Authorization': `Basic ${authHeader}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (response.status === 200 || response.status === 201) {
                console.log(`[Twilio Success] OTP sent to ${formattedNumber}. SID: ${response.data.sid}`);
                return true;
            } else {
                console.error("[Twilio Failed] Status code:", response.status, response.data);
                return false;
            }
        }

        console.error(`[SMS Helper] Error: Unknown SMS_PROVIDER value: ${provider}`);
        return false;

    } catch (error) {
        console.error(`[SMS Helper Error] Provider: ${provider} failed:`, error.response ? error.response.data : error.message);
        
        // Return false to prevent registrations/verifications on failed delivery
        return false;
    }
};