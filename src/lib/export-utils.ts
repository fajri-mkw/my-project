/**
 * Lazy loaders for heavy client-side export libraries.
 *
 * Why this exists
 * ----------------
 * `jspdf` (~350 KB), `xlsx` / SheetJS (~900 KB) and `jspdf-autotable` (~50 KB)
 * are by far the largest dependencies in the client bundle. When a view that
 * imports them at the top level is opened — especially on mobile — the browser
 * has to download, parse and execute ~1.3 MB of JavaScript before it can paint
 * a single pixel of that view. On phones with a slow CPU or a flaky connection
 * this manifests as a multi-second white screen / stuck loading state, even
 * though the same view loads instantly on a laptop.
 *
 * The fix is to defer loading these libraries until the user actually triggers
 * an export (clicks "Export PDF" / "Export Excel"). The reports/recap views
 * themselves only render lightweight UI (filters + cards), so they paint
 * immediately. The heavy libraries are fetched on demand the first time an
 * export is requested, and the resulting promise is cached so every subsequent
 * export is instant.
 *
 * Usage
 * -----
 *   const { jsPDF } = await loadJsPDF()
 *   const XLSX = await loadXLSX()
 *   const autoTable = (await loadAutoTable()).default
 */

type JsPDFModule = typeof import('jspdf')
type XLSXModule = typeof import('xlsx')
type AutoTableModule = typeof import('jspdf-autotable')

let pdfPromise: Promise<JsPDFModule> | null = null
let xlsxPromise: Promise<XLSXModule> | null = null
let autoTablePromise: Promise<AutoTableModule> | null = null

/**
 * Dynamically import `jspdf`. The module is cached after the first call so
 * repeated exports don't trigger a second network request.
 */
export function loadJsPDF(): Promise<JsPDFModule> {
  if (!pdfPromise) {
    pdfPromise = import('jspdf')
  }
  return pdfPromise
}

/**
 * Dynamically import `xlsx` (SheetJS). Cached after the first call.
 */
export function loadXLSX(): Promise<XLSXModule> {
  if (!xlsxPromise) {
    xlsxPromise = import('xlsx')
  }
  return xlsxPromise
}

/**
 * Dynamically import `jspdf-autotable`. Cached after the first call.
 *
 * Note: `jspdf-autotable`'s default export is a function `(doc, options) => …`
 * that also patches the jsPDF prototype with `doc.autoTable`. We always use the
 * functional form to be explicit.
 */
export function loadAutoTable(): Promise<AutoTableModule> {
  if (!autoTablePromise) {
    autoTablePromise = import('jspdf-autotable')
  }
  return autoTablePromise
}
