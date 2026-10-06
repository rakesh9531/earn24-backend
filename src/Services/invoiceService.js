const PDFDocument = require('pdfkit');

/**
 * Generates an 80mm POS Thermal Receipt Slip HTML (Swipe Machine / Receipt Printer format)
 * @param {Object} order - Order data including items and shipping address
 * @param {Object} user - User/Customer data
 * @param {Object} seller - Seller data (name, address, gstin)
 * @returns {string} - The complete HTML document string
 */
exports.generateThermalInvoiceHTML = (order, user, seller) => {
    const company = {
        name: seller?.display_name || seller?.name || "EARN24",
        tagline: "SHOP MORE | EARN MORE | HELP MORE",
        address: seller?.address || "Ground Floor, Galfarbari Badi Maszid,\nGalfarbari More, Near Kumardhubi Hospital,\nP.O. Kumardhubi, Egyarkund, Kumardhubi,\nDhanbad, Jharkhand – 828203 (India)",
        gstin: seller?.gstin || "20EIMPK5093M1ZU",
        supportEmail: "support@earn24.in"
    };

    const d = order.created_at ? new Date(order.created_at) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const orderDate = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    const orderTime = `${pad(d.getHours())} : ${pad(d.getMinutes())} : ${pad(d.getSeconds())}`;

    const invoiceNo = order.invoice_no || order.invoice_number || (1000000000 + parseInt(order.id || 1, 10)).toString();
    const orderNumber = order.order_number || (`ORD-${order.id}`);

    const shipping = order.shipping_address || {};
    const customerName = user.full_name || shipping.full_name || shipping.name || "Customer";
    
    const addrLine1 = shipping.address_line_1 || "";
    const addrLine2Parts = [
        shipping.address_line_2,
        shipping.landmark ? `Near ${shipping.landmark}` : null
    ].filter(Boolean).join(', ');

    const cityStatePin = [
        shipping.city,
        shipping.state,
        shipping.pincode ? `- ${shipping.pincode}` : ''
    ].filter(Boolean).join(' ').trim();

    const phone = user.phone_number || user.mobile_number || shipping.phone_number || "N/A";

    let activeSubtotal = 0;
    const items = (order.items || []).map((item, idx) => {
        const isCancelled = item.item_status === 'CANCELLED' || item.status === 'CANCELLED';
        const isReturned = item.item_status === 'RETURNED' || item.status === 'RETURNED' || item.return_status === 'REFUNDED';
        const qty = (isCancelled || isReturned) ? 0 : parseInt(item.quantity || 1, 10);
        const pricePerUnit = parseFloat(item.price_per_unit || 0);
        const itemTotal = (isCancelled || isReturned) ? 0 : parseFloat(item.total_price || (qty * pricePerUnit));

        if (!isCancelled && !isReturned) {
            activeSubtotal += itemTotal;
        }

        const hsn = item.hsn_code || "8517";
        const gstRate = parseFloat(item.gst_percentage || 18);
        const gstAmount = parseFloat((itemTotal * (gstRate / 100)).toFixed(2));

        let variantText = "";
        if (item.attributes) {
            let attrs = item.attributes;
            if (typeof attrs === 'string') {
                try { attrs = JSON.parse(attrs); } catch (e) { attrs = {}; }
            }
            if (typeof attrs === 'object' && attrs !== null) {
                variantText = Object.entries(attrs)
                    .filter(([k]) => !k.toLowerCase().includes('image'))
                    .map(([_, v]) => v)
                    .join(', ');
            }
        }

        const title = item.product_name || item.name || "Item";
        const desc = variantText ? `${title} (${variantText})` : title;

        return {
            sNo: idx + 1,
            desc,
            hsn,
            qty,
            totalPrice: itemTotal,
            gstRate,
            gstAmount
        };
    });

    const subtotal = activeSubtotal > 0 ? activeSubtotal : parseFloat(order.subtotal || 0);
    const deliveryFee = parseFloat(order.delivery_fee || 0);
    const grandTotal = parseFloat(order.total_amount || (subtotal + deliveryFee));

    const paymentMethodRaw = (order.payment_method || '').toUpperCase();
    let paymentMode = "Online";
    if (paymentMethodRaw === 'COD') paymentMode = "COD";
    else if (paymentMethodRaw === 'WALLET') paymentMode = "Wallet";
    else if (paymentMethodRaw.includes('PAYU') || paymentMethodRaw === 'ONLINE' || paymentMethodRaw === 'PREPAID') paymentMode = "Online";
    else if (paymentMethodRaw) paymentMode = paymentMethodRaw;

    const paymentStatusRaw = (order.payment_status || '').toUpperCase();
    const isPaid = ['PAID', 'COMPLETED', 'SUCCESS'].includes(paymentStatusRaw);
    const paymentStatus = isPaid ? "PAID" : (paymentMode === "COD" ? "CASH TO COLLECT" : "PENDING");
    const amountPaidLabel = (paymentMode === "COD" && !isPaid) ? "Amount to Collect:" : "Amount Paid:";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tax Invoice - ${orderNumber}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: #f1f5f9;
      color: #000000;
      font-family: 'Courier New', Courier, Monaco, monospace;
      font-size: 12px;
      line-height: 1.35;
      padding: 20px 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .no-print-toolbar {
      margin-bottom: 16px;
      display: flex;
      gap: 12px;
    }
    .btn-print {
      background: #0f172a;
      color: #ffffff;
      border: none;
      padding: 10px 22px;
      font-size: 14px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.18);
    }
    .btn-print:hover {
      background: #1e293b;
    }
    .btn-close {
      background: #e2e8f0;
      color: #334155;
      border: none;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
    }
    .receipt-container {
      width: 80mm;
      max-width: 80mm;
      min-width: 80mm;
      background: #ffffff;
      padding: 12px 10px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.1);
      border: 1px solid #cbd5e1;
    }
    .center {
      text-align: center;
    }
    .right {
      text-align: right;
    }
    .bold {
      font-weight: bold;
    }
    .brand-title {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 1px;
      margin-bottom: 2px;
    }
    .tagline {
      font-size: 10px;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .addr, .gstin {
      font-size: 11px;
      color: #111;
    }
    .gstin {
      margin-top: 2px;
    }
    .divider {
      border-top: 1px dashed #000000;
      margin: 6px 0;
    }
    .section-title {
      font-size: 13px;
      font-weight: bold;
      letter-spacing: 1px;
      margin: 4px 0;
    }
    .info-line {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      margin-bottom: 2px;
    }
    .bill-to-title {
      font-weight: bold;
      font-size: 12px;
      margin-bottom: 2px;
    }
    .bill-to-text {
      font-size: 11px;
      line-height: 1.3;
    }
    .items-table, .tax-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .items-table th, .tax-table th {
      padding: 4px 2px;
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      font-weight: bold;
      font-size: 11px;
    }
    .items-table td, .tax-table td {
      padding: 3px 2px;
      vertical-align: top;
    }
    .item-desc {
      word-break: break-word;
    }
    .gst-subrow td {
      padding-top: 0;
      padding-bottom: 5px;
      color: #222;
      font-size: 10.5px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
      font-size: 12px;
    }
    .grand-total-row {
      font-size: 13px;
      font-weight: 900;
      padding: 4px 0;
    }
    .footer-section {
      text-align: center;
      font-size: 10.5px;
      line-height: 1.4;
      margin: 4px 0;
    }
    @media print {
      @page {
        size: 80mm auto;
        margin: 0;
      }
      body {
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .no-print-toolbar {
        display: none !important;
      }
      .receipt-container {
        width: 80mm !important;
        max-width: 80mm !important;
        min-width: 80mm !important;
        box-shadow: none !important;
        border: none !important;
        padding: 4mm 3mm !important;
        margin: 0 !important;
      }
    }
  </style>
</head>
<body onload="window.print()">
  <div class="no-print-toolbar">
    <button class="btn-print" onclick="window.print()">🖨️ Print Slip / Bill</button>
    <button class="btn-close" onclick="window.close()">✕ Close</button>
  </div>

  <div class="receipt-container">
    <!-- Header -->
    <div class="center bold brand-title">${company.name}</div>
    <div class="center bold tagline">${company.tagline}</div>
    <div class="center addr">${company.address.replace(/\n/g, '<br>')}</div>
    <div class="center bold gstin">GSTIN: ${company.gstin}</div>

    <div class="divider"></div>

    <!-- Tax Invoice Meta -->
    <div class="center bold section-title">TAX INVOICE</div>
    <div class="info-line"><span>Invoice No:</span> <span class="bold">${invoiceNo}</span></div>
    <div class="info-line"><span>Order ID :</span> <span class="bold">${orderNumber}</span></div>
    <div class="info-line"><span>Date: ${orderDate}</span> <span>Time : ${orderTime}</span></div>

    <div class="divider"></div>

    <!-- Bill To -->
    <div class="bill-to-title">BILL TO</div>
    <div class="bill-to-text bold">${customerName}</div>
    ${addrLine1 ? `<div class="bill-to-text">${addrLine1}</div>` : ''}
    ${addrLine2Parts ? `<div class="bill-to-text">${addrLine2Parts}</div>` : ''}
    ${cityStatePin ? `<div class="bill-to-text">${cityStatePin}</div>` : ''}
    <div class="bill-to-text">Phone: ${phone}</div>

    <div class="divider"></div>

    <!-- Item Details -->
    <div class="center bold section-title">ITEM DETAILS</div>
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 10%; text-align: left;">S.No</th>
          <th style="width: 44%; text-align: left;">Description</th>
          <th style="width: 15%; text-align: center;">HSN</th>
          <th style="width: 10%; text-align: center;">Qty</th>
          <th style="width: 21%; text-align: right;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td style="text-align: left;">${it.sNo}</td>
            <td class="item-desc bold">${it.desc}</td>
            <td style="text-align: center;">${it.hsn}</td>
            <td style="text-align: center;">${it.qty}</td>
            <td style="text-align: right;" class="bold">₹${it.totalPrice.toFixed(2)}</td>
          </tr>
          <tr class="gst-subrow">
            <td></td>
            <td colspan="3">GST ${it.gstRate}%</td>
            <td style="text-align: right;">₹${it.gstAmount.toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="divider"></div>

    <!-- GST Breakdown -->
    <table class="tax-table">
      <thead>
        <tr>
          <th style="width: 15%; text-align: left;">S.No</th>
          <th style="width: 25%; text-align: center;">GST %</th>
          <th style="width: 30%; text-align: right;">GST Amount</th>
          <th style="width: 30%; text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td style="text-align: left;">${it.sNo}</td>
            <td style="text-align: center;">${it.gstRate}%</td>
            <td style="text-align: right;">₹${it.gstAmount.toFixed(2)}</td>
            <td style="text-align: right;" class="bold">₹${it.totalPrice.toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="divider"></div>

    <!-- Summary -->
    <div class="summary-row">
      <span>Subtotal</span>
      <span>₹${subtotal.toFixed(2)}</span>
    </div>
    <div class="summary-row">
      <span>Delivery Fee</span>
      <span>₹${deliveryFee.toFixed(2)}</span>
    </div>
    
    <div class="divider"></div>

    <div class="summary-row grand-total-row">
      <span>GRAND TOTAL</span>
      <span>₹${grandTotal.toFixed(2)}</span>
    </div>

    <div class="divider"></div>

    <!-- Payment -->
    <div class="center bold section-title">PAYMENT</div>
    <div class="info-line"><span>Payment Mode:</span> <span>${paymentMode}</span></div>
    <div class="info-line"><span>Payment Status:</span> <span class="bold">${paymentStatus}</span></div>
    <div class="info-line bold"><span>${amountPaidLabel}</span> <span>₹${grandTotal.toFixed(2)}</span></div>

    <div class="divider"></div>

    <!-- Footer -->
    <div class="footer-section">
      <div class="bold">Thank you for shopping with EARN24</div>
      <div class="bold">${company.tagline}</div>
      <div style="margin-top: 4px;">For returns, replacement & support</div>
      <div>Please contact ${company.supportEmail}</div>
    </div>

    <div class="divider"></div>
  </div>
</body>
</html>`;
};

/**
 * Generates an 80mm POS Slip PDF (matching the thermal receipt format)
 */
exports.generateInvoicePDF = (order, user, seller) => {
    return new Promise((resolve, reject) => {
        // 80mm is 226.77 points width. Height is estimated dynamically.
        const itemCount = (order.items || []).length;
        const pageHeight = Math.max(650, 420 + itemCount * 40);
        const doc = new PDFDocument({
            size: [226.77, pageHeight],
            margin: 10
        });

        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfData = Buffer.concat(buffers);
            resolve(pdfData);
        });

        const companyInfo = {
            name: seller?.display_name || seller?.name || "EARN24",
            tagline: "SHOP MORE | EARN MORE | HELP MORE",
            address: seller?.address || "Ground Floor, Galfarbari Badi Maszid,\nGalfarbari More, Near Kumardhubi Hospital,\nP.O. Kumardhubi, Egyarkund, Kumardhubi,\nDhanbad, Jharkhand – 828203 (India)",
            gstin: seller?.gstin || "20EIMPK5093M1ZU",
            email: "support@earn24.in"
        };

        const d = order.created_at ? new Date(order.created_at) : new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const orderDate = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
        const orderTime = `${pad(d.getHours())} : ${pad(d.getMinutes())} : ${pad(d.getSeconds())}`;
        const invoiceNo = order.invoice_no || order.invoice_number || (1000000000 + parseInt(order.id || 1, 10)).toString();

        const shipping = order.shipping_address || {};
        const customerName = user.full_name || shipping.full_name || "Customer";

        const line = () => {
            doc.moveDown(0.3);
            doc.text("------------------------------------------------", { align: 'center' });
            doc.moveDown(0.3);
        };

        // Header
        doc.font('Courier-Bold').fontSize(12).text(companyInfo.name, { align: 'center' });
        doc.font('Courier').fontSize(7.5).text(companyInfo.tagline, { align: 'center' });
        doc.text(companyInfo.address, { align: 'center' });
        doc.font('Courier-Bold').text(`GSTIN: ${companyInfo.gstin}`, { align: 'center' });
        
        line();

        // Invoice Meta
        doc.font('Courier-Bold').fontSize(10).text("TAX INVOICE", { align: 'center' });
        doc.font('Courier').fontSize(8);
        doc.text(`Invoice No: ${invoiceNo}`);
        doc.text(`Order ID  : ${order.order_number || ('ORD-' + order.id)}`);
        doc.text(`Date: ${orderDate} Time : ${orderTime}`);

        line();

        // Bill To
        doc.font('Courier-Bold').text("BILL TO");
        doc.font('Courier');
        doc.text(customerName);
        if (shipping.address_line_1) doc.text(shipping.address_line_1);
        const cityLine = [shipping.city, shipping.state, shipping.pincode ? `- ${shipping.pincode}` : ''].filter(Boolean).join(' ');
        if (cityLine) doc.text(cityLine);
        doc.text(`Phone: ${user.phone_number || user.mobile_number || shipping.phone_number || 'N/A'}`);

        line();

        // Item Details
        doc.font('Courier-Bold').text("ITEM DETAILS", { align: 'center' });
        line();

        let activeSubtotal = 0;
        doc.font('Courier-Bold').fontSize(7.5);
        doc.text("S.No Description        HSN   Qty   Price");
        doc.font('Courier').fontSize(7.5);

        (order.items || []).forEach((it, idx) => {
            const isCancelled = it.item_status === 'CANCELLED' || it.status === 'CANCELLED';
            const isReturned = it.item_status === 'RETURNED' || it.status === 'RETURNED';
            const qty = (isCancelled || isReturned) ? 0 : parseInt(it.quantity || 1, 10);
            const total = (isCancelled || isReturned) ? 0 : parseFloat(it.total_price || (qty * parseFloat(it.price_per_unit || 0)));
            if (!isCancelled && !isReturned) activeSubtotal += total;

            const name = (it.product_name || 'Item').substring(0, 18);
            const hsn = (it.hsn_code || '8517').substring(0, 5);
            doc.text(`${idx + 1}    ${name.padEnd(18)} ${hsn.padEnd(5)}  ${qty}   Rs.${total.toFixed(2)}`);
            const gstRate = parseFloat(it.gst_percentage || 18);
            const gstAmt = (total * (gstRate / 100)).toFixed(2);
            doc.text(`     GST ${gstRate}%                        Rs.${gstAmt}`);
        });

        line();

        // Summary
        const subtotal = activeSubtotal > 0 ? activeSubtotal : parseFloat(order.subtotal || 0);
        const fee = parseFloat(order.delivery_fee || 0);
        const grandTotal = parseFloat(order.total_amount || (subtotal + fee));

        doc.text(`Subtotal                              Rs.${subtotal.toFixed(2)}`);
        doc.text(`Delivery Fee                          Rs.${fee.toFixed(2)}`);
        line();
        doc.font('Courier-Bold').fontSize(8.5);
        doc.text(`GRAND TOTAL                           Rs.${grandTotal.toFixed(2)}`);
        doc.font('Courier').fontSize(7.5);
        line();

        // Payment
        doc.font('Courier-Bold').text("PAYMENT", { align: 'center' });
        doc.font('Courier');
        const isPaid = ['PAID', 'COMPLETED', 'SUCCESS'].includes((order.payment_status || '').toUpperCase());
        doc.text(`Payment Mode: ${(order.payment_method || 'Online').toUpperCase()}`);
        doc.text(`Payment Status: ${isPaid ? 'PAID' : 'PENDING'}`);
        doc.text(`Amount Paid:                          Rs.${grandTotal.toFixed(2)}`);

        line();

        // Footer
        doc.fontSize(7);
        doc.text("Thank you for shopping with EARN24", { align: 'center' });
        doc.text(companyInfo.tagline, { align: 'center' });
        doc.text("For returns, replacement & support", { align: 'center' });
        doc.text(`Please contact ${companyInfo.email}`, { align: 'center' });

        line();
        doc.end();
    });
};
