const path = require("path");

// Resolve dependencies from backend/node_modules if running from repo root
const possibleNodeModules = [
  path.resolve(__dirname, "../../backend/node_modules"),
  path.resolve(__dirname, "../node_modules"),
  path.resolve(__dirname, "./node_modules"),
];
for (const p of possibleNodeModules) {
  if (!module.paths.includes(p)) {
    module.paths.unshift(p);
  }
}

// Load environment variables (.env from backend or root)
require("dotenv").config({ path: path.resolve(__dirname, "../../backend/.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config();

const mongoose = require("mongoose");
const { retrieveContext } = require("./retrieval");
const { getAnswer } = require("./claudeService");

// Load Models
let HoldingsModel, OrdersModel, PositionsModel;
try {
  ({ HoldingsModel } = require("../../backend/model/HoldingsModel"));
  ({ OrdersModel } = require("../../backend/model/OrdersModel"));
  ({ PositionsModel } = require("../../backend/model/PositionsModel"));
} catch (e) {
  try {
    ({ HoldingsModel } = require("../model/HoldingsModel"));
    ({ OrdersModel } = require("../model/OrdersModel"));
    ({ PositionsModel } = require("../model/PositionsModel"));
  } catch (e2) {
    ({ HoldingsModel } = require("./model/HoldingsModel"));
    ({ OrdersModel } = require("./model/OrdersModel"));
    ({ PositionsModel } = require("./model/PositionsModel"));
  }
}

// Sector mapping for portfolio risk analysis
const SECTOR_MAPPING = {
  INFY: "Information Technology",
  TCS: "Information Technology",
  WIPRO: "Information Technology",
  KPITTECH: "Information Technology",
  HDFCBANK: "Banking & Financials",
  SBIN: "Banking & Financials",
  RELIANCE: "Conglomerate & Energy",
  TATAPOWER: "Power & Utilities",
  BHARTIARTL: "Telecommunications",
  HINDUNILVR: "FMCG & Consumer",
  ITC: "FMCG & Tobacco",
  "M&M": "Automotive",
  SGBMAY29: "Sovereign Gold / Commodities",
  EVEREADY: "Consumer Electricals",
  JUBLFOOD: "QSR & Consumer Discretionary",
  AAPL: "Technology & Consumer Electronics",
  TSLA: "Automotive & Clean Tech",
};

// Default platform fallback portfolio if database is empty/offline
const DEFAULT_HOLDINGS = [
  { name: "BHARTIARTL", qty: 2, avg: 538.05, price: 541.15, net: "+0.58%", day: "+2.99%" },
  { name: "HDFCBANK", qty: 2, avg: 1383.4, price: 1522.35, net: "+10.04%", day: "+0.11%" },
  { name: "HINDUNILVR", qty: 1, avg: 2335.85, price: 2417.4, net: "+3.49%", day: "+0.21%" },
  { name: "INFY", qty: 1, avg: 1350.5, price: 1555.45, net: "+15.18%", day: "-1.60%" },
  { name: "ITC", qty: 5, avg: 202.0, price: 207.9, net: "+2.92%", day: "+0.80%" },
  { name: "KPITTECH", qty: 5, avg: 250.3, price: 266.45, net: "+6.45%", day: "+3.54%" },
  { name: "M&M", qty: 2, avg: 809.9, price: 779.8, net: "-3.72%", day: "-0.01%" },
  { name: "RELIANCE", qty: 1, avg: 2193.7, price: 2112.4, net: "-3.71%", day: "+1.44%" },
  { name: "SBIN", qty: 4, avg: 324.35, price: 430.2, net: "+32.63%", day: "-0.34%" },
  { name: "SGBMAY29", qty: 2, avg: 4727.0, price: 4719.0, net: "-0.17%", day: "+0.15%" },
  { name: "TATAPOWER", qty: 5, avg: 104.2, price: 124.15, net: "+19.15%", day: "-0.24%" },
  { name: "TCS", qty: 1, avg: 3041.7, price: 3194.8, net: "+5.03%", day: "-0.25%" },
  { name: "WIPRO", qty: 4, avg: 489.3, price: 577.75, net: "+18.08%", day: "+0.32%" },
];

const DEFAULT_ORDERS = [
  { name: "INFY", qty: 2, price: 1550.0, mode: "BUY" },
  { name: "RELIANCE", qty: 1, price: 2120.0, mode: "BUY" },
  { name: "TCS", qty: 1, price: 3190.0, mode: "BUY" },
  { name: "HDFCBANK", qty: 2, price: 1520.0, mode: "BUY" },
  { name: "SBIN", qty: 4, price: 428.5, mode: "BUY" },
];

/**
 * Fetch holdings and orders from the database with graceful fallback
 */
async function fetchUserPortfolioData(userId) {
  let holdings = [];
  let orders = [];

  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    try {
      const holdingsQuery = userId ? { userId } : {};
      const ordersQuery = userId ? { userId } : {};

      holdings = await HoldingsModel.find(holdingsQuery).lean();
      if (!holdings || holdings.length === 0) {
        // If query by userId produced 0 results, check generic holdings
        holdings = await HoldingsModel.find({}).lean();
      }

      orders = await OrdersModel.find(ordersQuery).lean();
      if (!orders || orders.length === 0) {
        orders = await OrdersModel.find({}).lean();
      }
    } catch (err) {
      console.warn("[WARN] Database query failed in fetchUserPortfolioData:", err.message);
    }
  }

  if (!holdings || holdings.length === 0) {
    holdings = DEFAULT_HOLDINGS;
  }
  if (!orders || orders.length === 0) {
    orders = DEFAULT_ORDERS;
  }

  return { holdings, orders };
}

/**
 * Compute portfolio distribution, sector weights, concentration, and volatility metrics
 */
function analyzePortfolioMetrics(holdings, orders) {
  let totalInvested = 0;
  let totalCurrentValue = 0;
  const sectorWeights = {};
  const holdingAllocations = [];

  for (const h of holdings) {
    const qty = Number(h.qty) || 1;
    const avg = Number(h.avg) || Number(h.price) || 100;
    const price = Number(h.price) || avg;

    const invested = qty * avg;
    const currentVal = qty * price;
    totalInvested += invested;
    totalCurrentValue += currentVal;

    const sector = SECTOR_MAPPING[h.name] || "Other Equities";
    sectorWeights[sector] = (sectorWeights[sector] || 0) + currentVal;

    holdingAllocations.push({
      symbol: h.name,
      qty,
      avg,
      price,
      currentVal,
      pnl: currentVal - invested,
      pnlPct: ((price - avg) / avg) * 100,
      sector,
      day: h.day || "0.00%",
    });
  }

  // Sort by valuation descending
  holdingAllocations.sort((a, b) => b.currentVal - a.currentVal);

  // Calculate percentages
  const totalVal = totalCurrentValue || 1;
  holdingAllocations.forEach((item) => {
    item.weightPct = Number(((item.currentVal / totalVal) * 100).toFixed(2));
  });

  const sectorDistribution = Object.entries(sectorWeights)
    .map(([sector, val]) => ({
      sector,
      val,
      pct: Number(((val / totalVal) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.pct - a.pct);

  // Concentration: Top 3 holdings weight
  const top3Weight = holdingAllocations.slice(0, 3).reduce((acc, h) => acc + h.weightPct, 0);

  // Gainers vs Losers
  const losingPositions = holdingAllocations.filter((h) => h.pnl < 0);
  const winningPositions = holdingAllocations.filter((h) => h.pnl > 0);

  return {
    totalInvested: Number(totalInvested.toFixed(2)),
    totalCurrentValue: Number(totalCurrentValue.toFixed(2)),
    netPnL: Number((totalCurrentValue - totalInvested).toFixed(2)),
    netPnLPct: Number((((totalCurrentValue - totalInvested) / (totalInvested || 1)) * 100).toFixed(2)),
    topHoldings: holdingAllocations.slice(0, 5),
    top3Weight: Number(top3Weight.toFixed(2)),
    sectorDistribution,
    losingPositions,
    winningPositions,
    recentTradesCount: orders.length,
    recentTrades: orders.slice(-5),
  };
}

/**
 * Explains portfolio risk factors (concentration, volatility, sector exposure)
 *
 * @param {string} [userId] - Optional ID of the user whose portfolio is to be analyzed
 * @param {Object} [options] - Options including onToken for live streaming
 * @returns {Promise<string>} Plain-language risk analysis from Claude
 */
async function explainPortfolioRisk(userId, options = {}) {
  // 1. Fetch user holdings and recent trade orders
  const { holdings, orders } = await fetchUserPortfolioData(userId);

  // 2. Compute quantitative risk metrics
  const metrics = analyzePortfolioMetrics(holdings, orders);

  // 3. Retrieve relevant market context via retrieveContext
  const contextQuery = `portfolio risk volatility sector exposure concentration ${metrics.topHoldings
    .map((h) => h.symbol)
    .join(" ")}`;
  const contextChunks = await retrieveContext(contextQuery, "PORTFOLIO");

  // 4. Construct a factual portfolio context chunk
  const topHoldingsDesc = metrics.topHoldings
    .map(
      (h) =>
        `- ${h.symbol} (${h.sector}): ₹${h.currentVal.toFixed(2)} (${h.weightPct}% of portfolio, P&L: ${
          h.pnlPct >= 0 ? "+" : ""
        }${h.pnlPct.toFixed(2)}%)`
    )
    .join("\n");

  const sectorDesc = metrics.sectorDistribution
    .map((s) => `- ${s.sector}: ${s.pct}% (Valuation: ₹${s.val.toFixed(2)})`)
    .join("\n");

  const losersDesc =
    metrics.losingPositions.length > 0
      ? metrics.losingPositions.map((l) => `${l.symbol} (${l.pnlPct.toFixed(2)}%)`).join(", ")
      : "None (all positions currently in profit)";

  const recentTradesDesc = metrics.recentTrades
    .map((t) => `${t.mode} ${t.qty} ${t.name} @ ₹${Number(t.price).toFixed(2)}`)
    .join("; ");

  const portfolioSummaryChunk = {
    symbol: "PORTFOLIO_RISK_AUDIT",
    source: "trading_platform:user_portfolio_audit",
    publishedAt: new Date(),
    content: `User Portfolio Risk Assessment Data:
Total Current Valuation: ₹${metrics.totalCurrentValue} across ${holdings.length} holdings. Total Invested: ₹${metrics.totalInvested}. Net Unrealized P&L: ${metrics.netPnL >= 0 ? "+" : ""}₹${metrics.netPnL} (${metrics.netPnLPct}%).
Concentration Risk Profile:
Top 3 Holdings Concentration: ${metrics.top3Weight}% of total capital.
Largest Assets:
${topHoldingsDesc}

Sector Exposure Breakdown:
${sectorDesc}

Volatility & Drawdowns:
Underperforming/Negative Positions: ${losersDesc}.
Top Profit Contributors: ${metrics.winningPositions.slice(0, 3).map((w) => `${w.symbol} (+${w.pnlPct.toFixed(2)}%)`).join(", ")}.
Recent Execution Activity (${metrics.recentTradesCount} orders recorded):
${recentTradesDesc || "Standard accumulation orders"}.`,
  };

  // Combine market context with the user's specific portfolio data
  const combinedContext = [portfolioSummaryChunk, ...contextChunks];

  // 5. Prompt Claude to explain the portfolio's risk factors in plain language
  const prompt = `Analyze this user's investment portfolio and explain their risk factors in plain, clear, conversational financial language. Specifically address:
1. Concentration Risk: Is the portfolio too heavily dependent on a few stocks (top 3 holdings make up ${metrics.top3Weight}%)?
2. Sector Exposure: Which sectors dominate the portfolio (e.g., IT vs Financials) and what happens if that sector faces headwinds?
3. Volatility & Drawdowns: What positions are currently under water or experiencing price drops, and what does recent trade activity indicate?
4. Key Takeaways & Suggestions: 2-3 practical, actionable tips to balance risk and improve diversification.

Speak directly to the investor with a supportive, professional tone.`;

  const answer = await getAnswer(prompt, combinedContext, {
    onToken: options.onToken,
  });

  return answer;
}

module.exports = {
  explainPortfolioRisk,
  analyzePortfolioMetrics,
  fetchUserPortfolioData,
};

module.exports.default = explainPortfolioRisk;
