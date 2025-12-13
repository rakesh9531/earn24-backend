class PaymentGatewaySetting {
  constructor({
    id,
    gateway_name,
    is_active,
    encrypted_config,
    encryption_iv,
    created_at
  }) {
    this.id = id;
    this.gatewayName = gateway_name;
    // MySQL stores booleans as 0 or 1, so we convert it to true/false here
    this.isActive = is_active === 1 || is_active === true;
    
    // We keep these for internal use, but usually, we don't send them to the frontend
    this.encryptedConfig = encrypted_config;
    this.encryptionIv = encryption_iv;
    
    this.createdAt = created_at;
  }
}

module.exports = PaymentGatewaySetting;