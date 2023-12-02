/*
  Heliograph - Automatic Lighthouse Runner

  Usage: node script.mjs <url> [--mobile] [--block-gtm]

  Requires Lighthouse CLI, will use npx to run it.
*/

import { exec as lameExec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

// Configuration
const runs = 5;
const outputPath = "/home/tony/lighthouse/reports";

// Collect needed variables
const lighthouseBin = "npx --yes lighthouse@latest";
const url = process.argv[2];
const urlInfo = new URL(url);
const domain = urlInfo.hostname;
const device = process.argv.includes("--mobile") ? "mobile" : "desktop";
const blockGtm = process.argv.includes("--block-gtm");
const measureSynchronously = process.argv.includes("--sync");
const date = new Date().toISOString().replace(/:/g, ".");
const pathDir = urlInfo.pathname.substring(1).replace(/\//g, "-");
const fullOutputPath = path.join(
  outputPath,
  domain,
  pathDir,
  `${date}-${device}`
);

// Make it a promise so we can await it
const exec = promisify(lameExec);

if (process.argv.length < 3) {
  console.log("Please provide a URL to run Lighthouse against.");
  process.exit(1);
}

// Make sure the directory exists
if (!fs.existsSync(fullOutputPath)) {
  fs.mkdirSync(fullOutputPath, { recursive: true });
}

const colors = {
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

const measureHeadings = {
  total: "Total Score",
  lcp: "Largest Contentful Paint",
  fcp: "First Contentful Paint",
  fmp: "First Meaningful Paint",
  si: "Speed Index",
  tbt: "Total Blocking Time",
  mpf: "Max Potential FID",
  cls: "Cumulative Layout Shift",
  srt: "Server Response Time",
};

const measures = {
  total: [],
  lcp: [],
  fcp: [],
  fmp: [],
  si: [],
  tbt: [],
  mpf: [],
  cls: [],
  srt: [],
};

const getValueColor = (value) => {
  if (value < 0.5) {
    return colors.red;
  }

  if (value < 0.9) {
    return colors.yellow;
  }

  return colors.green;
};

const getAverage = (arr) => {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

const getDisplayValue = (value, measure) => {
  if (measure === "cls") {
    return value.toFixed(2);
  }

  if (measure === "total") {
    return `${(value * 100).toFixed(2)}%`;
  }

  return value < 1000
    ? `${value.toFixed(2)}ms`
    : `${(value / 1000).toFixed(2)}s`;
};

console.log(
  `Running Lighthouse on ${colors.yellow}${domain}${urlInfo.pathname}${colors.reset} (${device}), ${runs} times...`
);

const runLighthouse = async (index) => {
  console.log(
    `Collecting data, run ${index}/${runs}... ${
      measures.total.length
        ? `(${(getAverage(measures.total) * 100).toFixed(2)}% so far)`
        : ""
    }`
  );

  const outputName = path.join(fullOutputPath, `${date}-${index}`);
  const command = `${lighthouseBin} ${url} --only-categories=performance ${
    device === "desktop" ? "--preset=desktop" : ""
  } ${
    blockGtm ? `--blocked-url-patterns="https://www.googletagmanager.com"` : ""
  } --output="html,json" --output-path="${outputName}" --quiet --chrome-flags="--headless"`;

  // Run lighthouse
  await exec(command);

  const data = fs.readFileSync(`${outputName}.report.json`, "utf8");
  const { audits, categories } = JSON.parse(data);

  // Save until later
  measures.total.push(categories["performance"].score);
  measures.lcp.push(audits["largest-contentful-paint"]);
  measures.fcp.push(audits["first-contentful-paint"]);
  measures.fmp.push(audits["first-meaningful-paint"]);
  measures.si.push(audits["speed-index"]);
  measures.tbt.push(audits["total-blocking-time"]);
  measures.mpf.push(audits["max-potential-fid"]);
  measures.cls.push(audits["cumulative-layout-shift"]);
  measures.srt.push(audits["server-response-time"]);
};

// Run lighthouse x times
if (measureSynchronously) {
  for (let i = 0; i < runs; i++) {
    await runLighthouse(i + 1);
  }
} else {
  await Promise.all(
    Array.from({ length: runs }, async (_, i) => await runLighthouse(i + 1))
  );
}

// Console log and write to file
Object.keys(measures).forEach((measure) => {
  const avgValue = getAverage(
    measures[measure].map((val) => val.numericValue || val)
  );
  const avgScore = getAverage(measures[measure].map((val) => val.score));

  const msg = `${measureHeadings[measure]}: ${getDisplayValue(
    avgValue,
    measure
  )} ${
    measure !== "total" && measure !== "srt"
      ? `(${(avgScore * 100).toFixed()}%)`
      : ""
  } - [${measures[measure]
    .map((v) => getDisplayValue(v.numericValue || v, measure))
    .join(", ")}]`;

  const consoleMsg = `${colors.yellow}${measureHeadings[measure]}${
    colors.reset
  }: ${getValueColor(avgScore)}${getDisplayValue(avgValue, measure)} ${
    measure !== "total" && measure !== "srt"
      ? `(${(avgScore * 100).toFixed()}%)`
      : ""
  }${colors.reset} - [${measures[measure]
    .map((v) => getDisplayValue(v.numericValue || v, measure))
    .join(", ")}]`;

  fs.appendFileSync(path.join(fullOutputPath, "summary.txt"), msg + "\n");

  console.log(consoleMsg);
});
