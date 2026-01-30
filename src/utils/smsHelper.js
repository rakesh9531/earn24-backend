exports.sendSms = async (mobileNumber, otp) => {
    try {
        // --- FOR TESTING: STATIC OTP ---
        // We are logging it to the console so you can see it.
        // In this setup, the controller generates the OTP, but we can ignore it 
        // and force "123456" in the database if we wanted, 
        // but it is better to generate a real random number and just LOG it for now.
        
        console.log("=================================================");
        console.log(`[MOCK SMS] Sending OTP to ${mobileNumber}`);
        console.log(`[MOCK SMS] OTP CODE: ${otp}`);
        console.log("=================================================");

        // --- FUTURE INTEGRATION (Uncomment when buying SMS pack) ---
        // const axios = require('axios');
        // await axios.get(`https://api.msg91.com/api?mobile=${mobileNumber}&otp=${otp}&authkey=...`);

        return true; // Simulate success
    } catch (error) {
        console.error("SMS Failed:", error);
        return false;
    }
};








// const axios = require('axios');

// /**
//  * Send OTP via 2Factor.in
//  * API Format: https://2factor.in/API/V1/{api_key}/SMS/{phone_number}/{otp}/{template_name}
//  */
// exports.sendSms = async (mobileNumber, otp) => {
//     try {
//         const API_KEY = process.env.TWO_FACTOR_API_KEY || 'YOUR_ACTUAL_2FACTOR_API_KEY';
//         const TEMPLATE_NAME = 'DeliveryOTP'; // Ensure this template is approved in your 2Factor panel

//         // 2Factor requires phone numbers in international format or 10 digits
//         // We ensure it's a string and clean it
//         const cleanNumber = mobileNumber.toString().replace(/\D/g, '');

//         // --- REAL API CALL ---
//         const url = `https://2factor.in/API/V1/${API_KEY}/SMS/${cleanNumber}/${otp}/${TEMPLATE_NAME}`;
        
//         const response = await axios.get(url);

//         if (response.data.Status === 'Success') {
//             console.log(`[2Factor] OTP ${otp} sent successfully to ${cleanNumber}`);
//             return true;
//         } else {
//             console.error("[2Factor] API Error:", response.data);
//             return false;
//         }
//     } catch (error) {
//         console.error("SMS Failed:", error.response ? error.response.data : error.message);
        
//         // --- FALLBACK FOR DEVELOPMENT ---
//         console.log("=================================================");
//         console.log(`[SMS FALLBACK] Sending OTP to ${mobileNumber}`);
//         console.log(`[SMS FALLBACK] OTP CODE: ${otp}`);
//         console.log("=================================================");
        
//         return false;
//     }
// };