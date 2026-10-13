/**
 * Estilos del documento del reporte.
 *
 * Viven en una constante (y no en utilidades de Tailwind) por dos razones:
 *   1. El reporte se carga en una **ventana aparte** para imprimirlo como PDF.
 *      Este mismo texto se inyecta allí, así que el PDF sale idéntico a la
 *      vista previa sin depender de las hojas de estilo de la aplicación.
 *   2. Al no usar utilidades, el tema oscuro de la app no lo repinta: un
 *      reporte siempre es "papel blanco".
 */
export const REPORT_CSS = `
  /* ------------------------------ Vista previa ------------------------------ */
  .rp-shell {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
    padding: 16px;
    background: rgb(15 23 42 / 0.65);
    backdrop-filter: blur(2px);
  }

  .rp-toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0 auto;
    width: 100%;
    max-width: 210mm;
    padding: 12px 16px;
    border-radius: 12px;
    background: #ffffff;
    box-shadow: 0 10px 30px rgb(15 23 42 / 0.25);
  }

  .rp-toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: #0f172a; }
  .rp-toolbar-hint { display: block; font-size: 11px; font-weight: 400; color: #64748b; }
  .rp-toolbar-actions { display: flex; align-items: center; gap: 8px; }

  .rp-scroll { padding-bottom: 24px; }

  /* ---------------------------------- Hoja ---------------------------------- */
  .rp {
    box-sizing: border-box;
    width: 210mm;
    max-width: 100%;
    min-height: 297mm;
    margin: 0 auto;
    padding: 14mm 13mm;
    background: #ffffff;
    color: #0f172a;
    font-family: Inter, system-ui, 'Segoe UI', sans-serif;
    font-size: 11px;
    line-height: 1.45;
    box-shadow: 0 20px 50px rgb(15 23 42 / 0.35);
    border-radius: 6px;
  }

  .rp * { box-sizing: border-box; }

  .rp-bar { height: 5px; border-radius: 999px; background: linear-gradient(90deg, #203ee0, #5c86ff 60%, #91b0ff); }

  /* -------------------------------- Cabecera -------------------------------- */
  .rp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-top: 12px; }
  .rp-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }

  .rp-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 64px;
    height: 64px;
    overflow: hidden;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
  }

  .rp-logo img { width: 100%; height: 100%; object-fit: contain; }
  .rp-logo span { font-size: 20px; font-weight: 700; color: #203ee0; letter-spacing: 0.5px; }

  .rp-company-name { font-size: 16px; font-weight: 700; line-height: 1.2; color: #0f172a; }
  .rp-company-rif { margin-top: 2px; font-size: 10.5px; font-weight: 600; color: #203ee0; letter-spacing: 0.4px; }
  .rp-company-lines { margin-top: 3px; font-size: 10px; color: #64748b; }
  .rp-company-lines span { display: block; }

  .rp-doc { flex: 0 0 auto; text-align: right; }
  .rp-doc-title {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.4px;
    color: #0f172a;
  }
  .rp-doc-range {
    display: inline-block;
    margin-top: 4px;
    padding: 3px 10px;
    border-radius: 999px;
    background: #eef4ff;
    font-size: 10.5px;
    font-weight: 600;
    color: #1b31b5;
  }
  .rp-doc-meta { margin-top: 6px; font-size: 9.5px; color: #94a3b8; }

  .rp-rule { height: 1px; margin: 12px 0 14px; background: #e2e8f0; }

  /* ------------------------------- Secciones -------------------------------- */
  .rp-section { margin-bottom: 14px; }
  .rp-section-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.9px;
    color: #1b31b5;
  }
  .rp-section-title small { font-size: 9.5px; font-weight: 500; letter-spacing: 0; text-transform: none; color: #94a3b8; }

  /* ------------------------------- Tarjetas --------------------------------- */
  .rp-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .rp-card {
    padding: 8px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
  }
  .rp-card-label { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; }
  .rp-card-value { margin-top: 2px; font-size: 14px; font-weight: 700; color: #0f172a; }
  .rp-card-hint { margin-top: 1px; font-size: 9.5px; color: #94a3b8; }

  .rp-card.is-good .rp-card-value { color: #047857; }
  .rp-card.is-bad .rp-card-value { color: #be123c; }
  .rp-card.is-brand .rp-card-value { color: #1b31b5; }

  /* --------------------------------- Tablas --------------------------------- */
  .rp-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }

  .rp-table { width: 100%; border-collapse: collapse; }
  .rp-table th {
    padding: 5px 6px;
    border-bottom: 1px solid #cbd5e1;
    background: #f1f5f9;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #475569;
    text-align: left;
    white-space: nowrap;
  }
  .rp-table td {
    padding: 4.5px 6px;
    border-bottom: 1px solid #eef2f7;
    font-size: 10px;
    color: #1e293b;
    vertical-align: top;
  }
  .rp-table tbody tr:nth-child(even) td { background: #fbfcfe; }
  .rp-table .rp-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rp-table tfoot td {
    padding: 6px;
    border-top: 1px solid #cbd5e1;
    background: #f1f5f9;
    font-size: 10px;
    font-weight: 700;
    color: #0f172a;
  }
  .rp-table .rp-strong { font-weight: 600; color: #0f172a; }
  .rp-table .rp-dim { color: #64748b; }
  .rp-table .rp-pos { color: #047857; }
  .rp-table .rp-neg { color: #be123c; }

  .rp-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 999px;
    background: #f1f5f9;
    font-size: 9px;
    font-weight: 600;
    color: #475569;
    white-space: nowrap;
  }

  .rp-empty { padding: 10px 0; font-size: 10.5px; color: #94a3b8; font-style: italic; }
  .rp-note { margin-top: 5px; font-size: 9.5px; color: #94a3b8; }

  /* ----------------------------------- Pie ---------------------------------- */
  .rp-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #e2e8f0;
    font-size: 9px;
    color: #94a3b8;
  }
  .rp-foot strong { color: #64748b; }

  .rp-sign { display: flex; gap: 32px; margin-top: 22px; }
  .rp-sign div { flex: 1; padding-top: 20px; border-top: 1px solid #cbd5e1; font-size: 9px; color: #94a3b8; text-align: center; }

  /* Al imprimir la pantalla directamente, solo sale el papel. */
  @media print {
    .rp-shell { position: static; padding: 0; background: #ffffff; }
    .rp-toolbar { display: none !important; }
    .rp { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
  }
`;

/** Estilos que solo se usan en la ventana de impresión (el documento a PDF). */
export const REPORT_PRINT_CSS = `
  @page { size: A4; margin: 13mm 12mm; }

  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  body {
    margin: 0;
    background: #ffffff;
    color: #0f172a;
    font-family: Inter, system-ui, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .rp { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }

  /* Nada de secciones ni filas partidas por la mitad de una hoja; los
     encabezados de tabla se repiten en cada página. */
  .rp-section, .rp-cards, .rp-sign { break-inside: avoid; }
  .rp-table thead { display: table-header-group; }
  .rp-table tr { break-inside: avoid; }
  .rp-section-title { break-after: avoid; }
`;
