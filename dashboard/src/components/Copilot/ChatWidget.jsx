import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./ChatWidget.css";

const rawApiUrl = process.env.REACT_APP_API_URL || "http://localhost:3002";
const DEFAULT_BACKEND_URL = rawApiUrl.startsWith("http")
  ? rawApiUrl
  : `https://${rawApiUrl}`;

const POPULAR_SYMBOLS = ["AAPL", "RELIANCE", "INFY", "TCS", "TSLA", "ALL"];

export default function ChatWidget({ defaultSymbol = "AAPL", userId = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [currentSymbol, setCurrentSymbol] = useState(defaultSymbol);
  const [inputQuery, setInputQuery] = useState("");
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I am your AI Trading Copilot. Ask me about stock market catalysts, technical ranges, company fundamentals, or click 'Analyze my risk' for a portfolio audit.",
      sources: [],
      timestamp: new Date(),
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Initialize Socket.io connection
  useEffect(() => {
    const socket = io(DEFAULT_BACKEND_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setErrorMessage("");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      setIsConnected(false);
      setErrorMessage("Could not connect to Copilot backend.");
    });

    // Listen for incoming streamed tokens
    socket.on("copilot:stream", (data) => {
      const incomingToken = data?.token || data?.text || "";

      setMessages((prevMessages) => {
        const lastIdx = prevMessages.length - 1;
        if (lastIdx < 0) return prevMessages;

        const lastMsg = prevMessages[lastIdx];
        if (lastMsg.role !== "assistant" || !lastMsg.streaming) {
          return prevMessages;
        }

        const updatedLast = {
          ...lastMsg,
          content: lastMsg.content + incomingToken,
        };

        const updatedList = [...prevMessages];
        updatedList[lastIdx] = updatedLast;
        return updatedList;
      });
    });

    // Listen for query / analysis completion
    socket.on("copilot:done", (data) => {
      setIsStreaming(false);

      setMessages((prevMessages) => {
        const lastIdx = prevMessages.length - 1;
        if (lastIdx < 0) return prevMessages;

        const lastMsg = prevMessages[lastIdx];
        if (lastMsg.role !== "assistant") return prevMessages;

        const updatedLast = {
          ...lastMsg,
          streaming: false,
          content: data?.answer || lastMsg.content,
          sources: data?.sources || [],
        };

        const updatedList = [...prevMessages];
        updatedList[lastIdx] = updatedLast;
        return updatedList;
      });
    });

    // Listen for error events
    socket.on("copilot:error", (data) => {
      setIsStreaming(false);
      const errMsg = data?.message || data?.error || "Error during request.";
      setErrorMessage(errMsg);

      setMessages((prevMessages) => {
        const lastIdx = prevMessages.length - 1;
        if (lastIdx >= 0 && prevMessages[lastIdx].streaming) {
          const updatedLast = {
            ...prevMessages[lastIdx],
            streaming: false,
            content:
              prevMessages[lastIdx].content ||
              `[Error]: ${errMsg}`,
          };
          const updatedList = [...prevMessages];
          updatedList[lastIdx] = updatedLast;
          return updatedList;
        }
        return prevMessages;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Auto-scroll to bottom of messages container
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isStreaming]);

  // Send free-text query via Socket.io
  const handleSendMessage = (textToSend) => {
    const query = (textToSend || inputQuery).trim();
    if (!query || isStreaming) return;

    setErrorMessage("");

    const userMsg = {
      id: "user_" + Date.now(),
      role: "user",
      content: query,
      symbol: currentSymbol,
      timestamp: new Date(),
    };

    const assistantMsg = {
      id: "asst_" + (Date.now() + 1),
      role: "assistant",
      content: "",
      streaming: true,
      sources: [],
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputQuery("");
    setIsStreaming(true);

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("copilot:query", {
        query: query,
        symbol: currentSymbol === "ALL" ? "" : currentSymbol,
      });
    } else {
      setIsStreaming(false);
      setErrorMessage("Socket is currently disconnected. Reconnecting...");
    }
  };

  // Trigger portfolio risk explanation
  const handleAnalyzeRisk = () => {
    if (isStreaming) return;

    setErrorMessage("");

    const userMsg = {
      id: "user_risk_" + Date.now(),
      role: "user",
      content: "Analyze my risk",
      symbol: "PORTFOLIO",
      timestamp: new Date(),
    };

    const assistantMsg = {
      id: "asst_risk_" + (Date.now() + 1),
      role: "assistant",
      content: "",
      streaming: true,
      sources: [],
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("copilot:portfolio_risk", {
        userId: userId || null,
      });
    } else {
      setIsStreaming(false);
      setErrorMessage("Socket is currently disconnected. Reconnecting...");
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleSendMessage();
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: "welcome_" + Date.now(),
        role: "assistant",
        content: "Chat cleared. What stock or trade would you like to analyze?",
        sources: [],
        timestamp: new Date(),
      },
    ]);
    setErrorMessage("");
  };

  return (
    <>
      {/* Floating Action Button (FAB) Toggle */}
      <button
        className="copilot-fab-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Toggle AI Trading Copilot"
      >
        <span className="sparkle-icon">✨</span>
        <span>{isOpen ? "Close Copilot" : "AI Copilot"}</span>
      </button>

      {/* Backdrop overlay for mobile */}
      {isOpen && (
        <div
          className="copilot-panel-overlay"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-in Sidebar Panel */}
      <aside className={`copilot-panel ${isOpen ? "open" : ""}`}>
        {/* Header */}
        <div className="copilot-header">
          <div className="copilot-title-section">
            <span
              className={`copilot-status-dot ${
                isConnected ? "connected" : "disconnected"
              }`}
              title={isConnected ? "Connected" : "Disconnected"}
            />
            <h4>Trading Copilot</h4>
          </div>
          <div className="copilot-header-actions">
            <button
              className="copilot-btn-icon"
              onClick={handleClearChat}
              title="Clear conversation"
            >
              🗑️
            </button>
            <button
              className="copilot-btn-icon"
              onClick={() => setIsOpen(false)}
              title="Close panel"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 'Analyze my risk' Quick Action Bar */}
        <div className="copilot-actions-bar">
          <button
            className="copilot-risk-btn"
            onClick={handleAnalyzeRisk}
            disabled={isStreaming}
            title="Analyze portfolio concentration, sector exposure, and volatility risk"
          >
            <span>🛡️</span>
            <span>Analyze my risk</span>
          </button>
        </div>

        {/* Stock Symbol Context Filter Bar */}
        <div className="copilot-symbol-bar">
          <span className="copilot-symbol-label">Context:</span>
          <div className="copilot-symbol-pill-list">
            {POPULAR_SYMBOLS.map((sym) => (
              <button
                key={sym}
                className={`copilot-symbol-pill ${
                  currentSymbol === sym ? "active" : ""
                }`}
                onClick={() => setCurrentSymbol(sym)}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Error Banner if any */}
        {errorMessage && (
          <div className="copilot-error-banner">⚠️ {errorMessage}</div>
        )}

        {/* Scrollable Messages Area */}
        <div className="copilot-messages">
          {messages.length === 1 && (
            <div className="copilot-empty-state">
              <div className="copilot-empty-icon">📈</div>
              <p>Ask real-time questions about market moves, company filings, or holdings.</p>
              <div className="copilot-quick-prompts">
                <button
                  className="copilot-quick-btn risk"
                  onClick={handleAnalyzeRisk}
                >
                  🛡️ "Analyze my risk factors"
                </button>
                <button
                  className="copilot-quick-btn"
                  onClick={() =>
                    handleSendMessage(`Why did ${currentSymbol} drop today?`)
                  }
                >
                  "Why did {currentSymbol} drop today?"
                </button>
                <button
                  className="copilot-quick-btn"
                  onClick={() =>
                    handleSendMessage(
                      `What is the technical range and valuation for ${currentSymbol}?`
                    )
                  }
                >
                  "What is the technical range for {currentSymbol}?"
                </button>
                <button
                  className="copilot-quick-btn"
                  onClick={() =>
                    handleSendMessage("Summarize my portfolio holdings and P&L")
                  }
                >
                  "Summarize my portfolio holdings & P&L"
                </button>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`copilot-message ${msg.role}`}>
              <div className="copilot-bubble">
                {msg.content}
                {msg.streaming && <span className="copilot-typing-cursor" />}
              </div>

              {/* Display cited sources metadata */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="copilot-sources">
                  <div className="copilot-sources-header">Cited Sources:</div>
                  <div>
                    {msg.sources.map((src, sIdx) => {
                      const label =
                        src.source?.replace(/^https?:\/\//, "").slice(0, 30) ||
                        `Source ${sIdx + 1}`;
                      return (
                        <a
                          key={sIdx}
                          href={
                            src.source?.startsWith("http") ? src.source : "#"
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="copilot-source-chip"
                          title={src.source}
                        >
                          [{sIdx + 1}] {src.symbol ? `${src.symbol}: ` : ""}
                          {label}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <div className="copilot-input-area">
          <form className="copilot-input-form" onSubmit={handleFormSubmit}>
            <input
              type="text"
              className="copilot-text-input"
              placeholder={`Ask Copilot about ${
                currentSymbol === "ALL" ? "stocks" : currentSymbol
              }...`}
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              disabled={isStreaming}
            />
            <button
              type="submit"
              className="copilot-send-btn"
              disabled={!inputQuery.trim() || isStreaming}
              title="Send Message"
            >
              ➤
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
