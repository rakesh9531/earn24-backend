class WalletTransaction {
  constructor({
    id,
    user_id,
    txn_type,
    amount,
    source,
    reference_id,
    remarks,
    created_at
  }) {
    this.id = id;
    this.userId = user_id;
    this.type = txn_type; // 'credit' or 'debit'
    this.amount = amount;
    this.source = source; // e.g., 'signup_bonus', 'purchase', 'withdrawal'
    this.referenceId = reference_id;
    this.remarks = remarks;
    this.createdAt = created_at;
  }
}

module.exports = WalletTransaction;
