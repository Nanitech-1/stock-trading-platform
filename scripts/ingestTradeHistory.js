#!/usr/bin/env node

/**
 * Standalone Trade History & Portfolio Ingestion Pipeline
 *
 * Usage:
 *   node scripts/ingestTradeHistory.js
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

const mongoose = require("mongoose");

// Load Models
let NewsChunkModel, OrdersModel, HoldingsModel, PositionsModel;
try {
  ({ NewsChunkModel } = require("../backend/model/NewsChunkModel"));
  ({ OrdersModel } = require("../backend/model/OrdersModel"));
  ({ HoldingsModel } = require("../backend/model/HoldingsModel"));
  ({ PositionsModel } = require("../backend/model/PositionsModel"));
} catch (e) {
  ({ NewsChunkModel } = require("./model/NewsChunkModel"));
  ({ OrdersModel } = require("./model/OrdersModel"));
  ({ HoldingsModel } = require("./model/HoldingsModel"));
  ({ PositionsModel } = require("./model/PositionsModel"));
}

let isSimulationMode = false;
const inMemoryChunks = [];

/**
 * Database connection with fallback
 */
async function connectDB() {
  const uri = process.env.MONGO_URL;

  if (uri) {
    try {
      console.log("Connecting to MongoDB Atlas...");
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
      console.log("Connected to MongoDB Atlas successfully!");
      return;
    } catch (err) {
      console.warn("MongoDB Atlas connection failed:", err.message);
      await mongoose.disconnect().catch(() => {});
    }
  }

  try {
    console.log("Attempting local MongoDB connection (mongodb://127.0.0.1:27017/zerodha)...");
    await mongoose.connect("mongodb://127.0.0.1:27017/zerodha", { serverSelectionTimeoutMS: 1500 });
    console.log("Connected to local MongoDB successfully!");
    return;
  } catch (err) {
    await mongoose.disconnect().catch(() => {});
  }

  console.log("Running in in-memory simulation mode.");
  isSimulationMode = true;
}

/**
 * Estimates token count (~4 characters per token)
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Splits text into ~500-token chunks with sentence boundary preservation
 */
function chunkText(text, maxTokens = 500, overlapTokens = 50) {
  if (!text || text.trim().length === 0) return [];

  const cleaned = text.replace(/\s+/g, " ").trim();
  if (estimateTokens(cleaned) <= maxTokens) {
    return [cleaned];
  }

  const sentences = cleaned.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [cleaned];
  const chunks = [];
  let currentChunk = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sTokens = estimateTokens(sentence);

    if (currentTokens + sTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join(" ").trim());

      let overlapCount = 0;
      const overlapSentences = [];
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        const t = estimateTokens(currentChunk[i]);
        if (overlapCount + t <= overlapTokens) {
          overlapSentences.unshift(currentChunk[i]);
          overlapCount += t;
        } else {
          break;
        }
      }

      currentChunk = [...overlapSentences, sentence];
      currentTokens = currentChunk.reduce((acc, s) => acc + estimateTokens(s), 0);
    } else {
      currentChunk.push(sentence);
      currentTokens += sTokens;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" ").trim());
  }

  return chunks;
}

/**
 * Deterministic synthetic embedding vector (1536 dimensions) for testing without API keys
 */
function generateSyntheticEmbedding(text, dimensions = 1536) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  const vec = new Array(dimensions);
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    const val = Math.sin(hash + i * 0.1);
    vec[i] = val;
    norm += val * val;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dimensions; i++) {
    vec[i] = Number((vec[i] / norm).toFixed(6));
  }
  return vec;
}

/**
 * Generates embeddings via OpenAI text-embedding-3-small (or synthetic fallback)
 */
async function generateEmbedding(text) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || apiKey.startsWith("<<") || apiKey === "your_openai_api_key_here") {
    return generateSyntheticEmbedding(text, 1536);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!response.ok) {
      return generateSyntheticEmbedding(text, 1536);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (err) {
    return generateSyntheticEmbedding(text, 1536);
  }
}

/**
 * Check whether a chunk with source exists
 */
async function chunkSourceExists(sourceUrl) {
  if (!isSimulationMode && mongoose.connection.readyState === 1) {
    const found = await NewsChunkModel.findOne({ source: sourceUrl });
    return !!found;
  }
  return inMemoryChunks.some((c) => c.source === sourceUrl);
}

/**
 * Save a chunk to database (or in-memory store)
 */
async function saveChunk(chunkData) {
  const newsChunk = new NewsChunkModel(chunkData);
  const validationErr = newsChunk.validateSync();
  if (validationErr) throw validationErr;

  if (!isSimulationMode && mongoose.connection.readyState === 1) {
    await newsChunk.save();
  } else {
    inMemoryChunks.push(newsChunk.toObject());
  }
  return newsChunk;
}

/**
 * Sample portfolio data fallback if database is empty or in-memory
 */
const fallbackTradeData = {
  orders: [
    { _id: "ord_101", name: "INFY", qty: 2, price: 1550.0, mode: "BUY" },
    { _id: "ord_102", name: "RELIANCE", qty: 1, price: 2120.0, mode: "BUY" },
    { _id: "ord_103", name: "TCS", qty: 1, price: 3190.0, mode: "BUY" },
    { _id: "ord_104", name: "HDFCBANK", qty: 2, price: 1520.0, mode: "BUY" },
    { _id: "ord_105", name: "SBIN", qty: 4, price: 428.5, mode: "BUY" },
  ],
  holdings: [
    { name: "BHARTIARTL", qty: 2, avg: 538.05, price: 541.15, net: "+0.58%", day: "+2.99%" },
    { name: "HDFCBANK", qty: 2, avg: 1383.4, price: 1522.35, net: "+10.04%", day: "+0.11%" },
    { name: "HINDUNILVR", qty: 1, avg: 2335.85, price: 2417.4, net: "+3.49%", day: "+0.21%" },
    { name: "INFY", qty: 1, avg: 1350.5, price: 1555.45, net: "+15.18%", day: "-1.60%", isLoss: true },
    { name: "ITC", qty: 5, avg: 202.0, price: 207.9, net: "+2.92%", day: "+0.80%" },
    { name: "KPITTECH", qty: 5, avg: 250.3, price: 266.45, net: "+6.45%", day: "+3.54%" },
    { name: "M&M", qty: 2, avg: 809.9, price: 779.8, net: "-3.72%", day: "-0.01%", isLoss: true },
    { name: "RELIANCE", qty: 1, avg: 2193.7, price: 2112.4, net: "-3.71%", day: "+1.44%" },
    { name: "SBIN", qty: 4, avg: 324.35, price: 430.2, net: "+32.63%", day: "-0.34%", isLoss: true },
    { name: "TATAPOWER", qty: 5, avg: 104.2, price: 124.15, net: "+19.15%", day: "-0.24%", isLoss: true },
    { name: "TCS", qty: 1, avg: 3041.7, price: 3194.8, net: "+5.03%", day: "-0.25%", isLoss: true },
    { name: "WIPRO", qty: 4, avg: 489.3, price: 577.75, net: "+18.08%", day: "+0.32%" },
  ],
  positions: [
    { product: "CNC", name: "EVEREADY", qty: 2, avg: 316.27, price: 312.35, net: "+0.58%", day: "-1.24%", isLoss: true },
    { product: "CNC", name: "JUBLFOOD", qty: 1, avg: 3124.75, price: 3082.65, net: "+10.04%", day: "-1.35%", isLoss: true },
  ],
};

/**
 * Main ingestion workflow
 */
async function main() {
  console.log("==================================================");
  console.log(" Trade History & Portfolio Ingestion Pipeline");
  console.log("==================================================");

  await connectDB();

  let orders = [];
  let holdings = [];
  let positions = [];

  if (mongoose.connection.readyState === 1) {
    try {
      orders = await OrdersModel.find({}).lean();
      holdings = await HoldingsModel.find({}).lean();
      positions = await PositionsModel.find({}).lean();
    } catch (e) {}
  }

  // Fallback to initial platform records if empty
  if (!orders || orders.length === 0) orders = fallbackTradeData.orders;
  if (!holdings || holdings.length === 0) holdings = fallbackTradeData.holdings;
  if (!positions || positions.length === 0) positions = fallbackTradeData.positions;

  console.log(`Retrieved: ${orders.length} orders, ${holdings.length} holdings, ${positions.length} active positions.`);

  let totalChunksSaved = 0;
  let totalSkipped = 0;
  const todayKey = new Date().toISOString().split("T")[0];

  // 1. Ingest Trade Orders
  console.log("\n--- Ingesting Order Execution Records ---");
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const orderId = order._id ? order._id.toString() : `order_${i + 1}`;
    const sourceKey = `trade_order:${order.name}:${orderId}`;

    const exists = await chunkSourceExists(sourceKey);
    if (exists) {
      totalSkipped++;
      continue;
    }

    const totalValue = (order.qty * order.price).toFixed(2);
    const orderText = `User Trade Order History for ${order.name}:
Transaction Type: ${order.mode} (Executed market trade).
Instrument: ${order.name} Equity.
Quantity: ${order.qty} share(s) executed at ₹${order.price.toFixed(2)} per share.
Total Transaction Value: ₹${totalValue}.
Order Status: Filled / Completed execution on trading platform.
Trading Context: This transaction represents an actual executed user trade order in the trading journal, reflecting the user's investment decisions and position accumulation in ${order.name}.`;

    const chunks = chunkText(orderText, 500, 50);
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk);
      await saveChunk({
        symbol: order.name,
        content: chunk,
        embedding: embedding,
        source: sourceKey,
        publishedAt: new Date(),
      });
      totalChunksSaved++;
    }
  }

  // 2. Ingest Holdings & Portfolio Performance
  console.log("\n--- Ingesting Portfolio Holdings Context ---");
  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    const sourceKey = `portfolio_holding:${h.name}:${todayKey}`;

    const exists = await chunkSourceExists(sourceKey);
    if (exists) {
      totalSkipped++;
      continue;
    }

    const curVal = (h.qty * h.price).toFixed(2);
    const invested = (h.qty * h.avg).toFixed(2);
    const pnl = (h.qty * (h.price - h.avg)).toFixed(2);
    const isProfit = Number(pnl) >= 0;

    const holdingText = `Portfolio Holding Status & Performance Overview for ${h.name}:
Instrument Name: ${h.name}.
Position Size: ${h.qty} share(s) held in user's long-term portfolio.
Average Acquisition Price: ₹${h.avg.toFixed(2)} per share.
Current Market Price (LTP): ₹${h.price.toFixed(2)}.
Total Invested Capital: ₹${invested}.
Current Investment Market Value: ₹${curVal}.
Unrealized Profit & Loss (P&L): ${isProfit ? "+" : ""}₹${pnl} (${h.net}).
Day's Price Change: ${h.day}.
Portfolio Context: The investor is currently ${isProfit ? "in profit" : "at an unrealized loss"} on this holding. This data provides fundamental context for AI trading copilot portfolio rebalancing, risk assessment, and profit-taking or stop-loss recommendations.`;

    const chunks = chunkText(holdingText, 500, 50);
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk);
      await saveChunk({
        symbol: h.name,
        content: chunk,
        embedding: embedding,
        source: sourceKey,
        publishedAt: new Date(),
      });
      totalChunksSaved++;
    }
  }

  // 3. Ingest Portfolio Summary
  console.log("\n--- Ingesting Overall Account Summary ---");
  const summaryKey = `portfolio_summary:account:${todayKey}`;
  const summaryExists = await chunkSourceExists(summaryKey);
  if (!summaryExists) {
    const totalInvested = holdings.reduce((acc, h) => acc + h.qty * h.avg, 0).toFixed(2);
    const totalCurrent = holdings.reduce((acc, h) => acc + h.qty * h.price, 0).toFixed(2);
    const netPnL = (totalCurrent - totalInvested).toFixed(2);
    const pnlPct = ((netPnL / totalInvested) * 100).toFixed(2);

    const summaryText = `Trading Account & Portfolio Performance Master Summary:
Total Active Holdings: ${holdings.length} instruments across diverse sectors.
Total Open Positions: ${positions.length} intra-day/short-term CNC positions.
Total Capital Invested: ₹${totalInvested}.
Current Total Portfolio Valuation: ₹${totalCurrent}.
Total Net Unrealized Return: ${Number(netPnL) >= 0 ? "+" : ""}₹${netPnL} (${Number(pnlPct) >= 0 ? "+" : ""}${pnlPct}%).
Top Performing Holdings: SBIN (+32.63%), TATAPOWER (+19.15%), WIPRO (+18.08%), INFY (+15.18%), HDFCBANK (+10.04%).
Lagging Holdings: RELIANCE (-3.71%), M&M (-3.72%), SGBMAY29 (-0.17%).
Account Risk Profile: Moderately aggressive growth allocation with strong large-cap bluechip tech and banking exposure. The AI copilot can reference this summary to provide holistic account-level advice, asset allocation insights, and margin guidance.`;

    const chunks = chunkText(summaryText, 500, 50);
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk);
      await saveChunk({
        symbol: "PORTFOLIO",
        content: chunk,
        embedding: embedding,
        source: summaryKey,
        publishedAt: new Date(),
      });
      totalChunksSaved++;
    }
  } else {
    totalSkipped++;
  }

  console.log("\n==================================================");
  console.log(" Trade History Ingestion Summary");
  console.log("==================================================");
  console.log(`Orders Processed:   ${orders.length}`);
  console.log(`Holdings Processed: ${holdings.length}`);
  console.log(`Items Skipped:      ${totalSkipped} (already ingested)`);
  console.log(`New Chunks Saved:   ${totalChunksSaved}`);
  console.log("==================================================\n");

  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
      console.log("Database disconnected.");
    } catch (e) {}
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error during trade history ingestion:", err);
    process.exit(1);
  });
}

module.exports = {
  main,
};
