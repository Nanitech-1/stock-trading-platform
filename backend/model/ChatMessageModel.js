const mongoose = require("mongoose");
const { model } = mongoose;

const { ChatMessageSchema } = require("../schemas/ChatMessageSchema");

// Ensure User model alias exists for ref: "User" if UsersModel is loaded
try {
  const { UsersModel } = require("./UsersModel");
  if (UsersModel && !mongoose.models.User && UsersModel.schema) {
    mongoose.model("User", UsersModel.schema);
  }
} catch (e) {
  // Ignore if UsersModel is not yet loaded
}

const ChatMessageModel =
  mongoose.models.ChatMessage || new model("ChatMessage", ChatMessageSchema);

ChatMessageModel.ChatMessageModel = ChatMessageModel;
ChatMessageModel.ChatMessage = ChatMessageModel;

module.exports = ChatMessageModel;
module.exports.ChatMessageModel = ChatMessageModel;
module.exports.ChatMessage = ChatMessageModel;
