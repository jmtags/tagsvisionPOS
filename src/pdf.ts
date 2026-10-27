import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { invoiceStatus, lineAmount, paidAmount } from './domain';
import type { Invoice, InvoiceItem, Payment, Settings } from './domain';
export function invoicePdf(
  invoice: Invoice & { business_details?: Settings },
  items: InvoiceItem[],
  payments: Payment[],
  settings: Settings,
) {
  const doc = new jsPDF();
  const cfg = invoice.business_details || settings;
  const php = (n: number) =>
    `PHP ${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const paid = paidAmount(invoice.id, payments);
  let brandX = 14;
  if (cfg.logo_url?.startsWith('data:image/')) {
    const image = doc.getImageProperties(cfg.logo_url);
    const scale = Math.min(18 / image.width, 18 / image.height);
    doc.addImage(
      cfg.logo_url,
      14,
      12,
      image.width * scale,
      image.height * scale,
      undefined,
      'FAST',
    );
    brandX = 36;
  }
  doc.setFontSize(21);
  doc.setTextColor(cfg.brand_color);
  const nameLines = doc.splitTextToSize(cfg.business_name, 196 - brandX);
  doc.text(nameLines, brandX, 22);
  doc.setTextColor('#182238');
  doc.setFontSize(9);
  const businessY = 30 + (nameLines.length - 1) * 8;
  const business = doc.splitTextToSize([cfg.address, `${cfg.email}  ${cfg.phone}`].join('\n'), 180);
  doc.text(business, 14, businessY);
  let y = businessY + 8 + business.length * 4;
  doc.setFontSize(16);
  doc.text(`INVOICE ${invoice.number}`, 14, y);
  y += 7;
  doc.setFontSize(9);
  doc.text(
    `Issued: ${invoice.issue_date}    Due: ${invoice.due_date}    Status: ${invoiceStatus(invoice, paid)}`,
    14,
    y,
  );
  y += 8;
  const billing = doc.splitTextToSize(
    `Bill to: ${invoice.customer_name}\n${invoice.customer_email}\n${invoice.billing_address}`,
    180,
  );
  doc.text(billing, 14, y);
  y += billing.length * 4 + 6;
  autoTable(doc, {
    startY: y,
    head: [['Description', 'Quantity', 'Unit price', 'Amount']],
    body: items.map((l) => [
      l.description,
      String(l.quantity),
      php(l.unit_price),
      php(lineAmount(l.quantity, l.unit_price)),
    ]),
    headStyles: { fillColor: cfg.brand_color },
    styles: { fontSize: 9 },
    columnStyles: { 0: { cellWidth: 85 } },
  });
  autoTable(doc, {
    head: [],
    body: [
      ['Subtotal', php(invoice.subtotal)],
      ['Discount', php(invoice.discount)],
      [
        `${invoice.tax_label} (${invoice.tax_rate}%)`,
        php(invoice.total - invoice.subtotal + invoice.discount),
      ],
      ['Total', php(invoice.total)],
      ['Paid', php(paid)],
      ['Balance', php(Math.max(0, invoice.total - paid))],
    ],
    theme: 'plain',
    margin: { left: 112 },
    styles: { fontSize: 10 },
    columnStyles: { 1: { halign: 'right' } },
  });
  autoTable(doc, {
    head: [['Notes & terms']],
    body: [[`${invoice.notes}\n${invoice.terms}`]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: cfg.brand_color },
  });
  if (payments.length)
    autoTable(doc, {
      head: [['Payment date', 'Method', 'Reference', 'Amount']],
      body: payments
        .filter((p) => p.invoice_id === invoice.id)
        .map((p) => [p.created_at.slice(0, 10), p.method, p.reference, php(p.amount)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: cfg.brand_color },
    });
  const pages = doc.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n);
    doc.setFontSize(8);
    doc.setTextColor('#7b879a');
    doc.text(`Page ${n} of ${pages} · ${invoice.number}`, 14, 288);
  }
  return doc;
}
export async function shareInvoice(doc: jsPDF, number: string) {
  const file = new File([doc.output('blob')], `${number}.pdf`, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] }))
    await navigator.share({ files: [file], title: number });
  else {
    doc.save(`${number}.pdf`);
    return 'PDF downloaded. Attach it to your preferred message.';
  }
  return `Shared ${number}.`;
}
