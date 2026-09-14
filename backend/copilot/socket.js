const { retrieveContext } = require("./services/retrieval");
const { getAnswer } = require("./services/claudeService");
const { explainPortfolioRisk } = require("./services/portfolioRisk");

/**
 * Attaches AI Trading Copilot event listeners to a Socket.io server
 *
 * @param {import("socket.io").Server} io
 */
function setupCopilotSocket(io) {
  io.on("connection", (socket) => {
    console.log(`[Copilot Socket] Client connected: ${socket.id}`);

    /**
     * Handles 'copilot:query' event
     * Accepts:
     *   data = { query: string, symbol?: string }
     *   or (query: string, symbol?: string)
     */
    socket.on("copilot:query", async (data, maybeSymbol) => {
      let query = "";
      let symbol = "";

      if (typeof data === "object" && data !== null) {
        query = data.query || "";
        symbol = data.symbol || "";
      } else if (typeof data === "string") {
        query = data;
        symbol = typeof maybeSymbol === "string" ? maybeSymbol : "";
      }

      if (!query || !query.trim()) {
        socket.emit("copilot:error", {
          message: "Query cannot be empty.",
          error: "Query cannot be empty.",
        });
        return;
      }

      console.log(`[Copilot Socket] Query received: "${query}" (Symbol: ${symbol || "ALL"})`);

      try {
        // 1. Retrieve relevant context chunks from vector store
        const contextChunks = await retrieveContext(query, symbol);

        // 2. Stream answer token-by-token
        const fullAnswer = await getAnswer(query, contextChunks, {
          onToken: (token) => {
            socket.emit("copilot:stream", {
              token: token,
              text: token,
            });
          },
        });

        // 3. Emit done event when response finishes
        socket.emit("copilot:done", {
          query: query,
          symbol: symbol || null,
          answer: fullAnswer,
          sources: contextChunks.map((chunk) => ({
            id: chunk._id,
            symbol: chunk.symbol,
            source: chunk.source,
            date: chunk.date,
            score: chunk.score,
            content: chunk.content,
          })),
        });

        console.log(`[Copilot Socket] Query completed successfully for client: ${socket.id}`);
      } catch (err) {
        console.error(`[Copilot Socket] Error handling query:`, err.message);
        socket.emit("copilot:error", {
          message: err.message,
          error: err.message,
        });
      }
    });

    /**
     * Handles 'copilot:portfolio_risk' event
     * Fetches user holdings & trades from DB, calls retrieveContext, and streams Claude risk analysis
     */
    socket.on("copilot:portfolio_risk", async (data) => {
      const userId = typeof data === "object" && data !== null ? data.userId : data;
      console.log(`[Copilot Socket] Portfolio risk assessment requested (User: ${userId || "default"})`);

      try {
        const fullAnswer = await explainPortfolioRisk(userId, {
          onToken: (token) => {
            socket.emit("copilot:stream", {
              token: token,
              text: token,
            });
          },
        });

        socket.emit("copilot:done", {
          query: "Analyze my risk",
          symbol: "PORTFOLIO",
          answer: fullAnswer,
          sources: [
            {
              source: "trading_platform:portfolio_audit",
              symbol: "PORTFOLIO",
              date: new Date(),
              score: 1.0,
              content: "Live holdings and order execution ledger risk factors audit",
            },
          ],
        });

        console.log(`[Copilot Socket] Portfolio risk assessment completed for client: ${socket.id}`);
      } catch (err) {
        console.error(`[Copilot Socket] Error during portfolio risk analysis:`, err.message);
        socket.emit("copilot:error", {
          message: err.message,
          error: err.message,
        });
      }
    });

    socket.on("disconnect", () => {
      console.log(`[Copilot Socket] Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = {
  setupCopilotSocket,
};
