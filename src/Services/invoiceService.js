const PDFDocument = require('pdfkit');

/**
 * Generates a professional invoice PDF
 * @param {Object} order - Order data including items and shipping address
 * @param {Object} user - User/Customer data
 * @param {Object} seller - Seller data (name, address, gstin)
 * @returns {Promise<Buffer>} - The generated PDF buffer
 */
exports.generateInvoicePDF = (order, user, seller) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfData = Buffer.concat(buffers);
            resolve(pdfData);
        });

        const companyInfo = {
            name: seller.display_name || "EARN24",
            address: seller.address || "Corporate Office",
            gstin: seller.gstin || "N/A",
            email: "support@earn24.in"
        };

        // Draw Watermark (Diagonal Background Text)
        doc.save()
            .fillColor("#cccccc")
            .opacity(0.1)
            .fontSize(100)
            .rotate(-45, { origin: [300, 400] })
            .text("EARN24", 150, 400)
            .restore();

        doc.fillColor("#444444")
            .fontSize(20)
            .text(companyInfo.name, 50, 45)
            .fontSize(10)
            .text(companyInfo.address, 50, 70)
            .text(`GSTIN: ${companyInfo.gstin}`, 50, 85)
            .moveDown();

        // Invoice Header Details
        doc.fillColor("#000000")
            .fontSize(20)
            .text("TAX INVOICE", 50, 140, { align: 'right' });

        doc.fontSize(10)
            .text(`Invoice No: ${order.order_number}`, 50, 165, { align: 'right' })
            .text(`Date: ${new Date(order.created_at).toLocaleDateString()}`, 50, 180, { align: 'right' })
            .moveDown();

        // Horizontal Line
        doc.moveTo(50, 200).lineTo(550, 200).stroke();

        // Bill To Details
        const shipping = order.shipping_address || {};
        doc.fontSize(12).font('Helvetica-Bold').text("Bill To:", 50, 215);
        doc.fontSize(10).font('Helvetica')
            .text(user.full_name || "Customer", 50, 230)
            .text(`${shipping.address_line_1 || ""}, ${shipping.address_line_2 || ""}`, 50, 245)
            .text(`${shipping.city || ""}, ${shipping.state || ""} - ${shipping.pincode || ""}`, 50, 260)
            .text(`Phone: ${user.phone_number || "N/A"}`, 50, 275);

        // Table Header
        const tableTop = 310;
        doc.font('Helvetica-Bold');
        generateTableRow(doc, tableTop, "S.N.", "Description", "HSN", "Qty", "Price", "GST %", "Total");
        doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
        doc.font('Helvetica');

        // Table Rows
        let i = 0;
        let position = tableTop + 20;
        let activeSubtotal = 0;

        order.items.forEach(item => {
            const isCancelled = item.item_status === 'CANCELLED' || item.status === 'CANCELLED';
            const isReturned = item.item_status === 'RETURNED' || item.status === 'RETURNED' || item.return_status === 'REFUNDED';

            let statusTag = "";
            let itemQty = item.quantity;
            let itemTotal = parseFloat(item.total_price || (item.quantity * item.price_per_unit) || 0);

            if (isCancelled) {
                statusTag = " [CANCELLED]";
                itemTotal = 0;
                itemQty = 0;
            } else if (isReturned) {
                statusTag = " [RETURNED]";
                itemTotal = 0;
            } else {
                activeSubtotal += itemTotal;
            }

            generateTableRow(
                doc,
                position,
                i + 1,
                (item.product_name + statusTag).substring(0, 25),
                item.hsn_code || "N/A",
                itemQty,
                `${parseFloat(item.price_per_unit).toFixed(2)}`,
                `${item.gst_percentage || 0}%`,
                `${parseFloat(itemTotal).toFixed(2)}`
            );
            position += 20;
            i++;
        });

        // Summary Calculations
        const summaryTop = position + 30;
        doc.moveTo(350, summaryTop).lineTo(550, summaryTop).stroke();

        const displaySubtotal = activeSubtotal > 0 ? activeSubtotal : parseFloat(order.subtotal || 0);
        const displayFee = parseFloat(order.delivery_fee || 0);
        const displayGrandTotal = displaySubtotal + displayFee;

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text("Subtotal:", 350, summaryTop + 10);
        doc.font('Helvetica').text(`Rs. ${displaySubtotal.toFixed(2)}`, 480, summaryTop + 10, { align: 'right' });

        doc.font('Helvetica-Bold').text("Delivery Fee:", 350, summaryTop + 25);
        doc.font('Helvetica').text(`Rs. ${displayFee.toFixed(2)}`, 480, summaryTop + 25, { align: 'right' });

        doc.moveTo(350, summaryTop + 40).lineTo(550, summaryTop + 40).stroke();

        doc.fontSize(12).font('Helvetica-Bold');
        doc.text("Grand Total:", 350, summaryTop + 50);
        doc.text(`Rs. ${displayGrandTotal.toFixed(2)}`, 480, summaryTop + 50, { align: 'right' });

        // Footer
        doc.end();
    });
};

function generateTableRow(doc, y, sn, desc, hsn, qty, price, gst, total) {
    doc.fontSize(10)
        .text(sn, 50, y, { width: 25 })
        .text(desc, 80, y, { width: 130 })
        .text(hsn, 215, y, { width: 60 })
        .text(qty, 280, y, { width: 30 })
        .text(price, 315, y, { width: 60 })
        .text(gst, 385, y, { width: 40 })
        .text(total, 435, y, { align: 'right', width: 115 });
}
