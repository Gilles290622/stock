import React from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { capFrFirstLowerRest, formatFrSpace, formatInt } from "../../utils/format";

const InvoiceModal = ({
  open,
  onClose,
  company,
  clientInfo,
  user,
  invoiceNumber,
  lines,
  total,
  amountInWords,
}) => {
  if (!open) return null;

  const printInvoice = () => {
    const win = window.open("", "PRINT", "height=800,width=900");
    if (!win) return;

    const styles = `
      <style>
        body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial; padding: 16px; color: #111827; }
        .header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 12px; }
        .brand { font-size: 20px; font-weight: 700; color:#065f46; }
        .meta { text-align:right; font-size:12px; color:#374151; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; }
        .title { font-weight: 600; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-left: none; border-right: none; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; font-size: 12px; }
        thead tr { background: #f3f4f6; }
        th { background: transparent !important; text-align: left; }
        tfoot tr.total { background: #eaeaea; }
        tfoot td { font-weight: 600; border-top: none; border-bottom: none; }
        .right { text-align: right; }
        .muted { color:#6b7280; font-size:12px; }
        @media print {
          body, table, thead tr, tfoot tr.total, th, td {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      </style>
    `;

    const rowsHtml = (Array.isArray(lines) ? lines : [])
      .map(
        (l, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${capFrFirstLowerRest(l.designation_name)}</td>
            <td class="right">${Number(l.quantite).toLocaleString("fr-FR")}</td>
            <td class="right">${Number(l.prix).toLocaleString("fr-FR")}</td>
            <td class="right">${Number(l.montant).toLocaleString("fr-FR")}</td>
          </tr>
        `
      )
      .join("");

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Facture ${invoiceNumber}</title>
          ${styles}
        </head>
        <body>
          <div class="header">
            <div class="brand">${user?.full_name || "Votre entreprise"}</div>
            <div class="meta">
              <div><strong>Facture:</strong> ${invoiceNumber}</div>
            </div>
          </div>

          <div class="grid">
            <div class="card">
              <div class="title">Émetteur</div>
              <div>${company?.name || "Votre entreprise"}</div>
              ${company?.address ? `<div class="muted">${company.address}</div>` : ""}
              ${company?.phone ? `<div class="muted">${company.phone}</div>` : ""}
              ${company?.email ? `<div class="muted">${company.email}</div>` : ""}
            </div>
            <div class="card" style="border:none;">
              <div class="title">Client</div>
              <div>${clientInfo?.name || "N/A"}</div>
              ${clientInfo?.address ? `<div class="muted">${clientInfo.address}</div>` : ""}
              ${clientInfo?.phone ? `<div class="muted">${clientInfo.phone}</div>` : ""}
              ${clientInfo?.email ? `<div class="muted">${clientInfo.email}</div>` : ""}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Désignation</th>
                <th class="right">Quantité</th>
                <th class="right">Prix unitaire</th>
                <th class="right">Montant</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
            <tfoot>
              <tr class="total">
                <td colspan="4" class="right">Total</td>
                <td class="right">${Number(total).toLocaleString("fr-FR")} F CFA</td>
              </tr>
            </tfoot>
          </table>

          <p class="muted" style="margin-top:12px;">
            Arrêté la présente facture à la somme de ${amountInWords || ""}.
          </p>

          <script>
            window.onload = function(){
              window.print();
              window.onafterprint = function(){ window.close(); };
            };
          </script>
        </body>
      </html>
    `;

    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  const generateInvoicePdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 40;
    const marginY = 40;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(16);
    doc.setTextColor(6, 95, 70);
    doc.text(user?.full_name || "Votre entreprise", marginX, marginY);

    doc.setTextColor(17, 24, 39);
    doc.setFontSize(10);
    let y = marginY + 18;
    if (company?.address) { doc.text(String(company.address), marginX, y); y += 14; }
    if (company?.phone)   { doc.text(String(company.phone),   marginX, y); y += 14; }
    if (company?.email)   { doc.text(String(company.email),   marginX, y); y += 14; }

    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(12);
    doc.text(`Facture: ${invoiceNumber}`, pageWidth - marginX, marginY, { align: "right" });

    const clientStartY = y + 12;
    doc.setFontSize(12); doc.text("Client", marginX, clientStartY);
    doc.setFontSize(11);
    let cy = clientStartY + 16;
    doc.text(clientInfo?.name || "N/A", marginX, cy); cy += 14;
    if (clientInfo?.address) { doc.text(String(clientInfo.address), marginX, cy); cy += 14; }
    if (clientInfo?.phone)   { doc.text(String(clientInfo.phone),   marginX, cy); cy += 14; }
    if (clientInfo?.email)   { doc.text(String(clientInfo.email),   marginX, cy); cy += 14; }

    const tableStartY = cy + 16;

    const head = [["#", "Désignation", "Quantité", "Prix unitaire", "Montant"]];
    const body = (Array.isArray(lines) ? lines : []).map((l, i) => [
      String(i + 1),
      capFrFirstLowerRest(l.designation_name || ""),
      formatFrSpace(l.quantite),
      formatFrSpace(l.prix),
      formatFrSpace(l.montant),
    ]);

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginX, right: marginX },
      head,
      body,
      theme: "grid",
      tableWidth: pageWidth - marginX * 2,
      styles: {
        font: "helvetica",
        fontSize: 10,
        halign: "left",
        valign: "middle",
        cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
        overflow: "linebreak",
        lineColor: [229, 231, 235],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [243, 244, 246],
        textColor: [17, 24, 39],
        lineColor: [243, 244, 246],
        lineWidth: 0.5,
        halign: "left",
      },
      columnStyles: {
        0: { cellWidth: 26 },
        1: { cellWidth: "auto" },
        2: { halign: "right", cellWidth: 80 },
        3: { halign: "right", cellWidth: 90 },
        4: { halign: "right", cellWidth: 100 },
      },
      didParseCell: (data) => {
        if (typeof data.cell.text === "string") {
          data.cell.text = data.cell.text.replace(/\u202F|\u00A0/g, " ");
        } else if (Array.isArray(data.cell.text)) {
          data.cell.text = data.cell.text.map(t => String(t).replace(/\u202F|\u00A0/g, " "));
        }
      },
    });

    // Bandeau Total
    const lastY = doc.lastAutoTable?.finalY || tableStartY;
    const usableWidth = pageWidth - marginX * 2;
    const barY = lastY + 4;
    const barH = 26;

    doc.setFillColor(234, 234, 234);
    doc.rect(marginX, barY, usableWidth, barH, "F");

    doc.setTextColor(17, 24, 39);
    doc.setFontSize(11);
    doc.text("Total", marginX + usableWidth - 200, barY + 18);
    const totalText = `${formatFrSpace(total)} F CFA`;
    doc.text(totalText, marginX + usableWidth - 10, barY + 18, { align: "right" });

    const footY = barY + barH + 22;
    doc.setFontSize(10);
    doc.setTextColor(55, 65, 81);
    if (amountInWords) {
      doc.text(`Arrêté la présente facture à la somme de ${amountInWords}.`, marginX, footY, {
        maxWidth: usableWidth,
      });
    }

    const fileName = `Facture_${invoiceNumber}.pdf`;
    const blob = doc.output("blob");
    return { blob, fileName };
  };

  const buildInvoiceText = () => {
    const title = `Facture ${invoiceNumber} - ${company?.name || "Votre entreprise"}`;
    const client = `Client: ${clientInfo?.name || "N/A"}`;
    const totalNum = `${formatFrSpace(total)} F CFA`;
    const totalWords = amountInWords || "";
    const details =
      (Array.isArray(lines) ? lines : [])
        .map((l, i) =>
          `${i + 1}. ${capFrFirstLowerRest(l.designation_name)} — ` +
          `${formatFrSpace(l.quantite)} x ${formatFrSpace(l.prix)} = ` +
          `${formatFrSpace(l.montant)} F CFA`
        )
        .join("\n") || "Aucune ligne";

    return [title, client, `Total: ${totalNum}`, totalWords ? `Montant en lettres: ${totalWords}` : "", "", "Détails:", details]
      .filter(Boolean)
      .join("\n");
  };

  const shareInvoicePdfWhatsApp = async () => {
    const { blob, fileName } = generateInvoicePdf();
    const file = new File([blob], fileName, { type: "application/pdf" });
    const shareData = { files: [file], title: `Facture ${invoiceNumber}`, text: buildInvoiceText() };

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share(shareData);
        return;
      } catch {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const text = buildInvoiceText();
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4">
        <div className="px-6 pt-6">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Facture</h2>
            <div className="text-right text-sm text-gray-600">
              <div><span className="font-medium text-gray-800">Facture:</span> {invoiceNumber}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">Émetteur</div>
              <div>{company?.name || "Votre entreprise"}</div>
              {company?.address && <div className="text-sm text-gray-600">{company.address}</div>}
              {company?.phone && <div className="text-sm text-gray-600">{company.phone}</div>}
              {company?.email && <div className="text-sm text-gray-600">{company.email}</div>}
            </div>
            <div className="p-3">
              <div className="font-semibold mb-1">Client</div>
              <div>{clientInfo?.name || "N/A"}</div>
              {clientInfo?.address && <div className="text-sm text-gray-600">{clientInfo.address}</div>}
              {clientInfo?.phone && <div className="text-sm text-gray-600">{clientInfo.phone}</div>}
              {clientInfo?.email && <div className="text-sm text-gray-600">{clientInfo.email}</div>}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto max-h-[60vh]">
            <table className="min-w-full border border-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="py-2 px-2 border-b text-left w-12">#</th>
                  <th className="py-2 px-3 border-b text-left">Désignation</th>
                  <th className="py-2 px-3 border-b text-right">Quantité</th>
                  <th className="py-2 px-3 border-b text-right">Prix unitaire</th>
                  <th className="py-2 px-3 border-b text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(lines) ? lines : []).map((l, i) => (
                  <tr key={l.id || i} className="hover:bg-gray-50">
                    <td className="py-2 px-2 border-b">{i + 1}</td>
                    <td className="py-2 px-3 border-b">{capFrFirstLowerRest(l.designation_name)}</td>
                    <td className="py-2 px-3 border-b text-right tabular-nums">{formatInt(l.quantite)}</td>
                    <td className="py-2 px-3 border-b text-right tabular-nums">{formatInt(l.prix)}</td>
                    <td className="py-2 px-3 border-b text-right tabular-nums">{formatInt(l.montant)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50">
                  <td className="py-2 px-3 border-0" colSpan={4}>Total</td>
                  <td className="py-2 px-3 border-0 text-right font-semibold tabular-nums">{formatInt(total)} F CFA</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {amountInWords && (
            <p className="text-sm text-gray-700 mt-3">
              Arrêté la présente facture à la somme de {amountInWords}.
            </p>
          )}
        </div>

        <div className="mt-6 px-6 pb-6 flex items-center justify-end gap-3">
          <button type="button" className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50" onClick={onClose}>
            Fermer
          </button>

          <button
            type="button"
            onClick={shareInvoicePdfWhatsApp}
            className="inline-flex items-center rounded-md bg-[#25D366] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            title="Partager la facture (PDF) via WhatsApp"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"
                className="w-4 h-4 mr-2 fill-current" aria-hidden="true" focusable="false">
              <path d="M19.11 17.16c-.27-.14-1.58-.78-1.82-.87-.24-.09-.42-.14-.6.14-.18.27-.7.87-.86 1.05-.16.18-.32.2-.59.07-.27-.14-1.13-.42-2.16-1.34-.8-.71-1.34-1.59-1.5-1.86-.16-.27-.02-.41.12-.55.12-.12.27-.32.4-.48.13-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.6-1.44-.82-1.97-.22-.53-.44-.46-.6-.46-.16 0-.34-.02-.52-.02s-.48.07-.73.34c-.25.27-.96.94-.96 2.29s.99 2.66 1.13 2.85c.14.18 1.95 2.98 4.73 4.18.66.29 1.18.46 1.58.59.66.21 1.26.18 1.74.11.53-.08 1.58-.65 1.81-1.27.22-.62.22-1.15.16-1.27-.07-.11-.25-.18-.52-.32zM16.02 4C9.39 4 4.03 9.34 4.03 15.96c0 2.7.89 5.2 2.4 7.23L4 28l4.94-2.37c1.97 1.08 4.23 1.7 6.62 1.7 6.63 0 11.99-5.35 11.99-11.97C27.55 9.34 22.65 4 16.02 4zm0 21.76c-2.27 0-4.37-.74-6.07-1.99l-.43-.31-2.93 1.4.94-2.85-.3-.45a10.37 10.37 0 0 1-1.62-5.61c0-5.72 4.66-10.36 10.4-10.36 5.73 0 10.4 4.64 10.4 10.36 0 5.71-4.67 10.36-10.4 10.36z"/>
            </svg>
            WhatsApp (PDF)
          </button>

          <button
            type="button"
            className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            onClick={printInvoice}
          >
            Imprimer
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceModal;