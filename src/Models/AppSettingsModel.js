/**
 * A simple class to hold and provide easy access to parsed application settings.
 * This is not a direct model of a single row, but a container for all settings.
 */
class AppSettings {
  constructor(settingsArray) {
    // Default values to prevent errors if a setting is missing from the DB
    this.defaults = {
      profit_company_share_pct: 20.0,
      bv_generation_pct_of_profit: 80.0,
      profit_dist_cashback_pct: 0.0,
      profit_dist_sponsor_pct: 0.0,
      // Add other defaults as needed
    };

    // Use reduce to transform the array of { setting_key, setting_value }
    // into a single object like { profit_company_share_pct: 20.00, ... }
    const settingsMap = settingsArray.reduce((acc, setting) => {
      acc[setting.setting_key] = parseFloat(setting.setting_value);
      return acc;
    }, {});

    // Merge the database settings with the defaults
    Object.assign(this, this.defaults, settingsMap);
  }

  // Example helper method
  getCompanySharePercentage() {
    return this.profit_company_share_pct;
  }
  
  getBvGenerationPercentage() {
    return this.bv_generation_pct_of_profit;
  }
}

module.exports = AppSettings;