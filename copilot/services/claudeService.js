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

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
const REQUEST_TIMEOUT_MS = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || "30000", 10);

/**
 * System prompt strictly confining Claude to provided context chunks
 */
const SYSTEM_PROMPT = `You are the AI Trading Copilot for a stock trading platform.
Your objective is to provide accurate, concise, and professional financial insights based STRICTLY on the provided context chunks.

CRITICAL INSTRUCTIONS:
1. Answer the user's question using ONLY the factual information provided in the Context Chunks below.
2. Do NOT speculate, hallucinate, or bring in external knowledge not present in the provided chunks.
3. If the provided context does NOT contain enough information to answer the question, you MUST explicitly state:
   "I do not have enough information from the provided market data and news to answer this question."
4. Reference the specific sources or stock tickers mentioned in the context where relevant.
5. Maintain a professional, objective, and analytical trading assistant tone.`;

/**
 * Formats an array of context chunks into structured prompt text
 *
 * @param {Array<Object|string>} contextChunks
 * @returns {string}
 */
function formatContextChunks(contextChunks) {
  if (!Array.isArray(contextChunks) || contextChunks.length === 0) {
    return "No context chunks provided.";
  }

  return contextChunks
    .map((chunk, index) => {
      const text = typeof chunk === "string" ? chunk : chunk.content || chunk.text || "";
      const source = chunk.source || chunk.metadata?.source || "N/A";
      const symbol = chunk.symbol || chunk.metadata?.symbol || "";
      const date = chunk.date || chunk.publishedAt || "";

      let header = `[Chunk ${index + 1}]`;
      if (symbol) header += ` (Symbol: ${symbol})`;
      if (source !== "N/A") header += ` (Source: ${source})`;
      if (date) header += ` (Date: ${new Date(date).toISOString().split("T")[0]})`;

      return `${header}\n${text.trim()}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Local simulation for testing when ANTHROPIC_API_KEY is not configured
 */
function generateSimulatedAnswer(query, contextChunks) {
  if (!contextChunks || contextChunks.length === 0) {
    return "I do not have enough information from the provided market data and news to answer this question.";
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const relevantChunks = contextChunks.filter((chunk) => {
    const text = (typeof chunk === "string" ? chunk : chunk.content || "").toLowerCase();
    return queryTerms.some((term) => text.includes(term));
  });

  if (relevantChunks.length === 0) {
    return "I do not have enough information from the provided market data and news to answer this question.";
  }

  const bestChunk = relevantChunks[0];
  const content = typeof bestChunk === "string" ? bestChunk : bestChunk.content || "";
  const source = bestChunk.source || "the retrieved market reports";

  return `Based on the provided context from ${source}: ${content}`;
}

/**
 * Queries Anthropic Claude API with context-grounded prompt, supporting token-by-token streaming
 *
 * @param {string} query - The user's question or trading query
 * @param {Array<Object|string>} contextChunks - Retrieved relevant chunks with content and metadata
 * @param {Object} [options] - Optional configurations (model, maxTokens, retries, onToken)
 * @returns {Promise<string>} The response text from Claude
 */
async function getAnswer(query, contextChunks, options = {}) {
  if (!query || typeof query !== "string" || !query.trim()) {
    throw new Error("Query must be a non-empty string.");
  }

  const onToken = typeof options.onToken === "function" ? options.onToken : null;

  // If no context chunks are supplied, return standard notice without API call
  if (!Array.isArray(contextChunks) || contextChunks.length === 0) {
    const defaultMsg = "I do not have enough information from the provided market data and news to answer this question.";
    if (onToken) {
      onToken(defaultMsg);
    }
    return defaultMsg;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Fallback to local grounded simulation if API key is not configured
  if (!apiKey || apiKey.startsWith("<<") || apiKey === "your_anthropic_api_key_here") {
    const simulatedAnswer = generateSimulatedAnswer(query, contextChunks);
    if (onToken) {
      // Stream simulated tokens word-by-word with small delay
      const tokens = simulatedAnswer.match(/\S+\s*/g) || [simulatedAnswer];
      for (const token of tokens) {
        onToken(token);
        await new Promise((r) => setTimeout(r, 15));
      }
    }
    return simulatedAnswer;
  }

  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || 1024;
  const formattedContext = formatContextChunks(contextChunks);

  const userContent = `Here are the relevant context chunks from the trading platform's vector database:

<context>
${formattedContext}
</context>

User Question: ${query.trim()}

Answer the question strictly using the information from the context above. If the context does not contain enough information, state that you do not have enough information.`;

  const isStreaming = !!onToken;
  const requestBody = {
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    stream: isStreaming,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  const maxRetries = options.retries !== undefined ? options.retries : 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle Rate Limiting (HTTP 429)
      if (response.status === 429) {
        const retryAfterSec = parseInt(response.headers.get("retry-after") || "2", 10);
        if (attempt <= maxRetries) {
          console.warn(`[WARN] Anthropic rate limit (429) encountered. Retrying in ${retryAfterSec}s (Attempt ${attempt}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
          continue;
        }
        throw new Error("Anthropic API rate limit exceeded (HTTP 429). Please try again shortly.");
      }

      // Handle other non-OK HTTP responses
      if (!response.ok) {
        let errorDetails = "";
        try {
          const errJson = await response.json();
          errorDetails = errJson?.error?.message || JSON.stringify(errJson);
        } catch (_) {
          errorDetails = await response.text();
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorDetails}`);
      }

      // If streaming is requested and response has a readable stream body
      if (isStreaming && response.body) {
        let accumulatedText = "";
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep partial line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6);
              if (dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  const deltaText = parsed.delta.text;
                  accumulatedText += deltaText;
                  onToken(deltaText);
                }
              } catch (_) {
                // Ignore parse errors on keepalive / ping events
              }
            }
          }
        }

        return accumulatedText.trim();
      }

      // Non-streaming response
      const data = await response.json();

      if (data.content && Array.isArray(data.content)) {
        const textBlock = data.content.find((block) => block.type === "text");
        if (textBlock && textBlock.text) {
          const text = textBlock.text.trim();
          if (onToken) onToken(text);
          return text;
        }
      }

      return "I do not have enough information from the provided market data and news to answer this question.";
    } catch (err) {
      clearTimeout(timeoutId);

      // Handle Timeout / Abort
      if (err.name === "AbortError") {
        if (attempt <= maxRetries) {
          console.warn(`[WARN] Anthropic API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Retrying...`);
          continue;
        }
        throw new Error(`Anthropic API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
      }

      // If it's the last attempt or an unrecoverable error, rethrow
      if (attempt > maxRetries || (err.message && !err.message.includes("429") && !err.message.includes("timed out"))) {
        throw err;
      }
    }
  }

  throw new Error("Failed to retrieve response from Anthropic API after retries.");
}

module.exports = {
  getAnswer,
  SYSTEM_PROMPT,
  formatContextChunks,
};

module.exports.default = getAnswer;
