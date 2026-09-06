const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 15000,
            connectTimeoutMS: 15000,
        });

        console.log("MongoDB Connected");
        return true;
    } catch (error) {
        console.error("Database Connection Failed. Retrying in 30 seconds.");
        console.error(error.message);
        setTimeout(connectDB, 30000);
        return false;
    }
};

module.exports = connectDB;
