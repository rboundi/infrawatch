import puppeteer from "puppeteer";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { config } from "../../config.js";

export async function renderToPdf(html: string, outputPath: string): Promise<void> {
  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };

  if (config.puppeteerExePath) {
    launchOptions.executablePath = config.puppeteerExePath;
  }

  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
  } finally {
    await browser.close();
  }
}
