const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    // bcrypt hash. Never select this by default: a stray .find() must not be
    // able to leak password material into an API response.
    passwordHash: {
        type: String,
        required: true,
        select: false,
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    role: {
        type: String,
        enum: ["admin", "member"],
        default: "member",
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// Shape sent to clients. Keeps passwordHash and __v out of every response.
userSchema.methods.toPublic = function toPublic() {
    return {
        id: String(this._id),
        email: this.email,
        name: this.name,
        role: this.role,
        createdAt: this.createdAt,
    };
};

module.exports = mongoose.model("User", userSchema);
