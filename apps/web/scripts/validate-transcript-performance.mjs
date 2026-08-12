import { chromium } from "playwright";

const DEFAULT_URL = "http://127.0.0.1:59111/";
const DEFAULT_MESSAGE_COUNTS = [1_000, 5_000, 10_000];

function parseArguments(argv) {
  const options = {
    url: DEFAULT_URL,
    messageCounts: DEFAULT_MESSAGE_COUNTS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--messages") {
      const counts = (argv[index + 1] ?? "")
        .split(",")
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0);
      if (counts.length === 0) throw new Error("--messages requires positive comma-separated integers");
      options.messageCounts = counts;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    options.url = argument;
  }

  return options;
}

const options = parseArguments(process.argv.slice(2));
const browser = await chromium.launch({ headless: true });
const measurements = [];

try {
  for (const messageCount of options.messageCounts) {
    const page = await browser.newPage({ viewport: { width: 1_440, height: 960 } });
    const url = new URL(options.url);
    url.searchParams.set("messages", String(messageCount));
    url.searchParams.set("animations", "off");
    url.searchParams.set("shimmer", "off");
    url.searchParams.set("scrollFade", "off");

    const startedAt = performance.now();
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__veylenPerf !== undefined);
    await page.waitForTimeout(1_000);
    const initial = await page.evaluate(() => window.__veylenPerf.snapshot());
    await page.evaluate(() => window.__veylenPerf.resetMetrics());
    const scroll = await page.evaluate(() => window.__veylenPerf.scrollCycle(1));
    const streaming = await page.evaluate(() => window.__veylenPerf.appendStreamingChunks(60));
    const final = await page.evaluate(() => window.__veylenPerf.snapshot());

    measurements.push({
      messageCount,
      loadMs: performance.now() - startedAt,
      initial,
      scroll,
      streaming,
      final,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

const failures = measurements.flatMap((measurement) => {
  const errors = [];
  if (measurement.final.domNodeCount > 2_000) {
    errors.push(`${measurement.messageCount}: DOM node count ${measurement.final.domNodeCount} exceeds 2000`);
  }
  if (measurement.scroll.p95Ms > 34) {
    errors.push(`${measurement.messageCount}: scroll p95 ${measurement.scroll.p95Ms.toFixed(2)}ms exceeds 34ms`);
  }
  if (measurement.streaming.p95Ms > 34) {
    errors.push(`${measurement.messageCount}: stream p95 ${measurement.streaming.p95Ms.toFixed(2)}ms exceeds 34ms`);
  }
  return errors;
});

console.log(
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      url: options.url,
      thresholds: { domNodeCount: 2_000, p95FrameMs: 34 },
      measurements,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;
