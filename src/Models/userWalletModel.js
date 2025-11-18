class Wallet {
  constructor({
    id,
    user_id,
    balance,
    locked_balance,
    created_at,
    updated_at
  }) {
    this.id = id;
    this.userId = user_id;
    this.balance = balance;
    this.lockedBalance = locked_balance;
    this.createdAt = created_at;
    this.updatedAt = updated_at;
  }
}

module.exports = Wallet;
