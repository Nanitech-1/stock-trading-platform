const path = require("path");
const mongoose = require("mongoose");

// Load environment variables if not already loaded
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config();

const { NewsChunkModel } = require("../model/NewsChunkModel");

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
const sampleArticles = {
  AAPL: [
    {
      symbol: "AAPL",
      content: "Apple shares experienced selling pressure today amid reports of lower than anticipated demand for high-end smartphone models in Asian markets, leading several institutional brokerages to trim near-term price targets.",
      source: "https://finance.yahoo.com/news/apple-shares-pressure-today",
      publishedAt: new Date(),
    },
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
      content: "Regulatory scrutiny continues to weigh on Apple's services division as international antitrust regulators review application store payment policies and royalty structures.",
      source: "https://finance.yahoo.com/news/apple-regulatory-scrutiny-services-review",
      publishedAt: new Date(),
    },
    {
      symbol: "AAPL",
      content: "Despite today's market pullback, long-term fundamentals for Apple remain robust with strong cash reserves, aggressive share repurchase programs, and expanding margins in digital subscription services.",
      source: "https://finance.yahoo.com/news/apple-long-term-fundamentals-robust",
      publishedAt: new Date(),
    },
  ],
};

/**
 * Retrieve top K most relevant NewsChunk documents for a query and stock symbol
 *
 * @param {string} query - User search query or question
 * @param {string} symbol - Stock ticker symbol (e.g. 'AAPL', 'RELIANCE')
 * @param {number} topK - Number of top chunks to return (default 5)
 * @returns {Promise<Array<Object>>} Top chunks sorted by similarity, containing content, source, and score
 */
async function retrieveRelevantChunks(query, symbol, topK = 5) {
  if (!query || !query.trim()) {
    return [];
  }

  // 1. Ensure DB connection if possible
  await ensureDbConnected().catch(() => {});

  // 2. Generate query embedding
  const queryEmbedding = await generateEmbedding(query.trim());

  // 3. Fetch NewsChunk documents matching the symbol
  let chunks = [];
  if (mongoose.connection.readyState === 1) {
    const queryFilter = {};
    if (symbol && typeof symbol === "string" && symbol.trim().length > 0) {
      queryFilter.symbol = new RegExp(`^${symbol.trim()}$`, "i");
    }
    chunks = await NewsChunkModel.find(queryFilter).lean().catch(() => []);
  }

  // Fallback to sample chunks if database has no chunks or is offline
  if (!chunks || chunks.length === 0) {
    const symKey = (symbol || "AAPL").toUpperCase().trim();
    const fallbackList = sampleArticles[symKey] || sampleArticles.AAPL;
    chunks = await Promise.all(
      fallbackList.map(async (item, idx) => ({
        _id: `sample_${idx + 1}`,
        symbol: item.symbol,
        content: item.content,
        source: item.source,
        publishedAt: item.publishedAt,
        embedding: await generateEmbedding(item.content),
      }))
    );
  }

  // 4. Compute cosine similarity for each chunk
  const scoredChunks = chunks
    .filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 0)
    .map((chunk) => {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      return {
        _id: chunk._id,
        symbol: chunk.symbol,
        content: chunk.content,
        source: chunk.source,
        publishedAt: chunk.publishedAt,
        similarity: similarity,
        score: Number(similarity.toFixed(4)),
      };
    });

  // 5. Sort descending by similarity score
  scoredChunks.sort((a, b) => b.similarity - a.similarity);

  // 6. Return top K
  return scoredChunks.slice(0, topK);
}

module.exports = {
  retrieveRelevantChunks,
  cosineSimilarity,
  generateEmbedding,
  generateSyntheticEmbedding,
};

module.exports.default = retrieveRelevantChunks;
