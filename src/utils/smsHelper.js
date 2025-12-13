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