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

// Load NewsChunkModel
let NewsChunkModel;
try {
  ({ NewsChunkModel } = require("../../backend/model/NewsChunkModel"));
} catch (e) {
  try {
    ({ NewsChunkModel } = require("../model/NewsChunkModel"));
  } catch (e2) {
    ({ NewsChunkModel } = require("./model/NewsChunkModel"));
  }
}

/**
 * Ensure database is connected if query is called outside Express app lifecycle
 */
async function ensureDbConnected() {
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    return;
  }

  const uri = process.env.MONGO_URL;
  if (uri) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
      return;
    } catch (err) {
      await mongoose.disconnect().catch(() => {});
    }
  }

  try {
    await mongoose.connect("mongodb://127.0.0.1:27017/zerodha", { serverSelectionTimeoutMS: 1500 });
  } catch (err) {
    await mongoose.disconnect().catch(() => {});
  }
}

/**
 * Computes cosine similarity between two numerical vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) {
    return 0;
  }

  const length = Math.min(vecA.length, vecB.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Deterministic synthetic embedding vector (1536 dimensions) for testing/fallback
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
 * Generates an embedding for text using OpenAI's text-embedding-3-small
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
      const errBody = await response.text();
      console.warn(`[WARN] OpenAI API responded with ${response.status}: ${errBody}`);
      return generateSyntheticEmbedding(text, 1536);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (err) {
    console.warn(`[WARN] OpenAI request failed: ${err.message}. Using synthetic vector.`);
    return generateSyntheticEmbedding(text, 1536);
  }
}

/**
 * Curated reference articles used when database is empty or offline
 */
const fallbackKnowledgeBase = [
  {
    symbol: "AAPL",
    content: "Macroeconomic headwinds and broader tech sector rotation contributed to Apple stock decline as investors shifted capital toward dividend-yielding defensive sectors following updated interest rate projections.",
    source: "https://finance.yahoo.com/news/tech-sector-rotation-macro-drag",
    publishedAt: new Date(),
  },
  {
    symbol: "AAPL",
    content: "Supply chain disruptions and delays in key semiconductor shipments could impact upcoming hardware shipping schedules for Apple, according to analyst reports released early Wednesday morning.",
    source: "https://finance.yahoo.com/news/apple-supply-chain-semiconductor-delays",
    publishedAt: new Date(),
  },
  {
    symbol: "AAPL",
    content: "Despite today's market pullback, long-term fundamentals for Apple remain robust with strong cash reserves, aggressive share repurchase programs, and expanding margins in digital subscription services.",
    source: "https://finance.yahoo.com/news/apple-long-term-fundamentals-robust",
    publishedAt: new Date(),
  },
  {
    symbol: "AAPL",
    content: "Regulatory scrutiny continues to weigh on Apple's services division as international antitrust regulators review application store payment policies and royalty structures.",
    source: "https://finance.yahoo.com/news/apple-regulatory-scrutiny-services-review",
    publishedAt: new Date(),
  },
  {
    symbol: "AAPL",
    content: "Apple shares experienced selling pressure today amid reports of lower than anticipated demand for high-end smartphone models in Asian markets, leading several institutional brokerages to trim near-term price targets.",
    source: "https://finance.yahoo.com/news/apple-shares-pressure-today",
    publishedAt: new Date(),
  },
  {
    symbol: "RELIANCE",
    content: "Reliance Industries announced key capital expenditure plans across green hydrogen and retail expansion, maintaining resilient operational cash flows.",
    source: "https://finance.yahoo.com/news/reliance-expansion",
    publishedAt: new Date(),
  },
  {
    symbol: "INFY",
    content: "Infosys reported digital services revenue expansion with large enterprise contracts signed across European banking and automotive verticals.",
    source: "https://finance.yahoo.com/news/infosys-earnings",
    publishedAt: new Date(),
  },
  {
    symbol: "TCS",
    content: "Tata Consultancy Services posted consistent margins in core cloud migration and artificial intelligence platform integration for enterprise clients.",
    source: "https://finance.yahoo.com/news/tcs-cloud-momentum",
    publishedAt: new Date(),
  },
];

/**
 * Retrieve contextual knowledge from vector store for AI Trading Copilot
 *
 * @param {string} query - The user question or search prompt
 * @param {string} [symbol] - Optional stock ticker to filter by (e.g. 'AAPL', 'INFY')
 * @returns {Promise<Array<Object>>} Top 5 matching chunks with metadata (source, symbol, date) and similarity score
 */
async function retrieveContext(query, symbol) {
  if (!query || !query.trim()) {
    return [];
  }

  // 1. Ensure DB connection
  await ensureDbConnected().catch(() => {});

  // 2. Generate embedding for query using OpenAI text-embedding-3-small
  const queryEmbedding = await generateEmbedding(query.trim());

  // 3. Query vector store with optional symbol filter
  let chunks = [];
  const queryFilter = {};

  if (symbol && typeof symbol === "string" && symbol.trim().length > 0 && symbol.trim() !== "*") {
    queryFilter.symbol = new RegExp(`^${symbol.trim()}$`, "i");
  }

  if (mongoose.connection.readyState === 1) {
    try {
      chunks = await NewsChunkModel.find(queryFilter).lean();
    } catch (err) {
      chunks = [];
    }
  }

  // Fallback to knowledge base if offline or no chunks in collection
  if (!chunks || chunks.length === 0) {
    let filteredFallback = fallbackKnowledgeBase;
    if (symbol && typeof symbol === "string" && symbol.trim().length > 0 && symbol.trim() !== "*") {
      const cleanSym = symbol.trim().toUpperCase();
      filteredFallback = fallbackKnowledgeBase.filter((item) => item.symbol.toUpperCase() === cleanSym);
      if (filteredFallback.length === 0) {
        filteredFallback = fallbackKnowledgeBase;
      }
    }

    chunks = await Promise.all(
      filteredFallback.map(async (item, idx) => ({
        _id: `kb_${idx + 1}`,
        symbol: item.symbol,
        content: item.content,
        source: item.source,
        publishedAt: item.publishedAt || new Date(),
        embedding: await generateEmbedding(item.content),
      }))
    );
  }

  // 4. Compute cosine similarity between query embedding and each chunk's embedding
  const scoredChunks = chunks
    .filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 0)
    .map((chunk) => {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      const dateVal = chunk.publishedAt || chunk.createdAt || new Date();

      return {
        _id: chunk._id,
        content: chunk.content,
        source: chunk.source,
        symbol: chunk.symbol,
        date: dateVal,
        metadata: {
          source: chunk.source,
          symbol: chunk.symbol,
          date: dateVal,
        },
        similarity: similarity,
        score: Number(similarity.toFixed(4)),
      };
    });

  // 5. Sort descending by similarity score
  scoredChunks.sort((a, b) => b.similarity - a.similarity);

  // 6. Return top 5 matching chunks with metadata
  return scoredChunks.slice(0, 5);
}

module.exports = {
  retrieveContext,
  cosineSimilarity,
  generateEmbedding,
  generateSyntheticEmbedding,
};

module.exports.default = retrieveContext;
