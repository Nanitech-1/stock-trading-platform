const mongoose = require("mongoose");
const { model } = mongoose;

const { NewsChunkSchema } = require("../schemas/NewsChunkSchema");

const NewsChunkModel =
  mongoose.models.NewsChunk || new model("NewsChunk", NewsChunkSchema);

NewsChunkModel.NewsChunkModel = NewsChunkModel;
NewsChunkModel.NewsChunk = NewsChunkModel;

module.exports = NewsChunkModel;
module.exports.NewsChunkModel = NewsChunkModel;
module.exports.NewsChunk = NewsChunkModel;
