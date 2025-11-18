class WithdrawRequest {
  constructor({
    id,
    user_id,
    amount,
    status,
    method,
    account_info,
    requested_at,
    processed_at
  }) {
    this.id = id;
    this.userId = user_id;
    this.amount = amount;
    this.status = status; // 'pending', 'approved', 'rejected'
    this.method = method; // e.g., 'UPI', 'Bank'
    this.accountInfo = account_info;
    this.requestedAt = requested_at;
    this.processedAt = processed_at;
  }
}

module.exports = WithdrawRequest;
