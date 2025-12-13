class PaymentTransaction {
  constructor({
    transaction_id,
    user_id,
    amount,
    gateway,
    status,
    created_at
  }) {
    this.transactionId = transaction_id;
    this.userId = user_id;
    this.amount = parseFloat(amount); // Ensure amount is a number
    this.gateway = gateway; // e.g., 'razorpay', 'phonepe'
    this.status = status;   // 'PENDING', 'SUCCESS', 'FAILED'
    this.createdAt = created_at;
  }
}

module.exports = PaymentTransaction;