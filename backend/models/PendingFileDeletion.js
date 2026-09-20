const mongoose = require("mongoose");

// A durable outbox: created in the deletion transaction, removed only after
// filesystem cleanup succeeds. It also survives process crashes/restarts.
const pendingFileDeletionSchema = new mongoose.Schema({
    filename: { type: String, required: true },
    retryAt: { type: Date, default: Date.now, index: true },
    createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model("PendingFileDeletion", pendingFileDeletionSchema);
