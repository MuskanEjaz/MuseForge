const fs = require("fs");

function loadPdfjs() {
  try {
    return require("./backend/node_modules/pdfjs-dist/legacy/build/pdf.js");
  } catch (e1) {
    try {
      return require("pdfjs-dist/legacy/build/pdf.js");
    } catch (e2) {
      console.error("pdfjs-dist not found. Run: npm install pdfjs-dist@3.11.174 --prefix .\\backend");
      process.exit(1);
    }
  }
}

function cleanUrl(value = "") {
  let url = String(value || "").trim();
  if (/^www\./i.test(url)) url = "https://" + url;
  if (!/^https?:\/\//i.test(url) && /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(url)) {
    url = "https://" + url;
  }
  return url;
}

(async () => {
  const pdfPath = process.argv.slice(2).join(" ").replace(/^"|"$/g, "");
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error("PDF path missing/not found.");
    console.error('Usage: node .\\debug-pdf-links.js "C:\\path\\to\\your-cv.pdf"');
    process.exit(1);
  }

  const pdfjsLib = loadPdfjs();
  const buffer = fs.readFileSync(pdfPath);

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  console.log("PDF pages:", pdf.numPages);
  let totalLinks = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const annotations = await page.getAnnotations({ intent: "display" });
    const links = (annotations || []).filter(a => a.url || a.unsafeUrl);

    if (links.length) {
      console.log("\nPAGE", pageNumber, "LINKS:", links.length);
    }

    for (const link of links) {
      totalLinks++;
      console.log("-", cleanUrl(link.url || link.unsafeUrl || ""));
      console.log("  rect:", JSON.stringify(link.rect || []));
    }
  }

  console.log("\nTOTAL EMBEDDED LINKS FOUND:", totalLinks);

  if (!totalLinks) {
    console.log("\nRESULT: Is PDF me readable embedded hyperlinks nahi milay.");
    console.log("Ya to links real PDF annotations nahi hain, ya PDF export ne links flatten/remove kar diye hain.");
  } else {
    console.log("\nRESULT: PDF links readable hain. Agar app me auto-fill nahi ho rahe, matching/mapping logic fix karni hogi.");
  }
})().catch(err => {
  console.error("DEBUG FAILED:", err.message);
  process.exit(1);
});
