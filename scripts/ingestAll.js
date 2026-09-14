#!/usr/bin/env node

/**
 * Unified Ingestion Pipeline for AI Trading Copilot
 *
 * Ingests:
 *   1. Stock Market Data (Quotes, Valuation, Daily & 52-week ranges)
 *   2. Financial News (Headlines, summaries, and sentiment context)
 *   3. Trade & Portfolio History (Executed orders, active holdings, and account summary)
 *
 * All records are chunked (~500 tokens), embedded via OpenAI text-embedding-3-small,
 * and persisted to the NewsChunk vector collection with deduplication.
 *
 * Usage:
 *   node scripts/ingestAll.js
 *   node scripts/ingestAll.js AAPL,TSLA
 *   node scripts/ingestAll.js --all
 */

const path = require("path");

// Resolve dependencies from backend/node_modules
const possibleNodeModules = [
  path.resolve(__dirname, "../backend/node_modules"),
  path.resolve(__dirname, "./node_modules"),
  path.resolve(__dirname, "../node_modules"),
];
for (const p of possibleNodeModules) {
  if (!module.paths.includes(p)) {
    module.paths.unshift(p);
  }
}

// Load environment variables
require("dotenv").config({ path: path.resolve(__dirname, "../backend/.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const { main: ingestStockData } = require("./ingestStockData");
const { main: ingestTradeHistory } = require("./ingestTradeHistory");
const { main: ingestNews } = require("./ingestNews");

async function runAll() {
  console.log("=================================================================");
  console.log(" 🚀 STARTING FULL AI TRADING COPILOT VECTOR INGESTION PIPELINE");
  console.log("=================================================================\n");

  const startTime = Date.now();

  try {
    // 1. Ingest Stock Market Data
    console.log(">>> STEP 1: Ingesting Stock Market Data & Technical Profiles...");
    await ingestStockData();

    // 2. Ingest Financial News
    console.log("\n>>> STEP 2: Ingesting Financial News & Macro Analysis...");
    await ingestNews();

    // 3. Ingest Trade History & Portfolio Context
    console.log("\n>>> STEP 3: Ingesting User Trade History, Orders & Holdings...");
    await ingestTradeHistory();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n=================================================================");
    console.log(` ✅ ALL INGESTION PIPELINES COMPLETED SUCCESSFULLY IN ${elapsed}s`);
    console.log(" Vector store is now loaded with stock data, news, and trade context.");
    console.log("=================================================================\n");
  } catch (err) {
    console.error("Pipeline failure:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runAll();
}

module.exports = { runAll };
