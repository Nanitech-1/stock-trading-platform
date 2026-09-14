const { Schema } = require("mongoose");

const NewsChunkSchema = new Schema({
  symbol: {
    type: String,
  },
  content: {
    type: String,
  },
  embedding: {
    type: [Number],
  },
  source: {
    type: String,
  },
  publishedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = { NewsChunkSchema };
