const { Schema } = require("mongoose");

const ChatMessageSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  role: {
    type: String,
    enum: ["user", "assistant"],
  },
  content: {
    type: String,
  },
  sources: [
    {
      type: Schema.Types.ObjectId,
      ref: "NewsChunk",
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = { ChatMessageSchema };
