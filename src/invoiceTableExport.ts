import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SheetData } from 'write-excel-file/universal';
import type { Settings } from './domain';
import { reportHeaders, reportScope } from './invoiceReport';
import type { InvoiceReport } from './invoiceReport';

const php = (value: number) =>
  `PHP ${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function invoiceTablePdf(report: InvoiceReport, settings: Settings) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(18);
  doc.setTextColor(settings.brand_color);
  const title = doc.splitTextToSize(`${settings.business_name} - Invoice list`, 269);
  doc.text(title, 14, 18);
  doc.setFontSize(9);
  doc.setTextColor('#182238');
  const scope = doc.splitTextToSize(reportScope(report), 269);
  const scopeY = 20 + title.length * 7;
  doc.text(scope, 14, scopeY);
  autoTable(doc, {
    startY: scopeY + scope.length * 4 + 5,
    head: [reportHeaders],
    body: report.rows.map((r) => [
      r.number,
      r.customer,
      r.notes,
      r.issueDate,
      r.dueDate,
      php(r.total),
      php(r.balance),
      r.status,
    ]),
    foot: [
      [
        {
          content: `Totals (${report.rows.length} ${report.rows.length === 1 ? 'invoice' : 'invoices'})`,
          colSpan: 5,
        },
        php(report.total),
        php(report.balance),
        '',
      ],
    ],
    showFoot: 'lastPage',
    margin: { left: 14, right: 14, top: 14, bottom: 18 },
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: settings.brand_color },
    footStyles: { fillColor: '#edf2fc', textColor: '#182238', fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 29 },
      1: { cellWidth: 46 },
      2: { cellWidth: 55 },
      3: { cellWidth: 24 },
      4: { cellWidth: 24 },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { cellWidth: 25 },
    },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor('#7b879a');
    doc.text(`Page ${page} of ${pages}`, 14, 202);
  }
  return doc;
}

export async function invoiceTableExcel(report: InvoiceReport, settings: Settings) {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  const amount = (value: number) => ({
    value,
    type: Number,
    format: '"PHP "#,##0.00',
    align: 'right' as const,
  });
  const data: SheetData = [
    [
      { value: `${settings.business_name} — Invoice list`, fontWeight: 'bold', columnSpan: 8 },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    [
      { value: reportScope(report), wrap: true, columnSpan: 8, height: 32 },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
    reportHeaders.map((value) => ({
      value,
      fontWeight: 'bold',
      backgroundColor: settings.brand_color,
      textColor: '#ffffff',
    })),
    ...report.rows.map((r) => [
      r.number,
      r.customer,
      { value: r.notes, wrap: true },
      r.issueDate,
      r.dueDate,
      amount(r.total),
      amount(r.balance),
      r.status,
    ]),
    [
      {
        value: `Totals (${report.rows.length} ${report.rows.length === 1 ? 'invoice' : 'invoices'})`,
        fontWeight: 'bold',
        columnSpan: 5,
      },
      null,
      null,
      null,
      null,
      { ...amount(report.total), fontWeight: 'bold' },
      { ...amount(report.balance), fontWeight: 'bold' },
      null,
    ],
  ];
  // Strings stay text, including customer/notes beginning with '='; no user text becomes a formula.
  return writeExcelFile(data, {
    sheet: 'Invoices',
    stickyRowsCount: 3,
    columns: [20, 35, 55, 14, 14, 20, 20, 20].map((width) => ({ width })),
    orientation: 'landscape',
  }).toBlob();
}

export function downloadReport(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
