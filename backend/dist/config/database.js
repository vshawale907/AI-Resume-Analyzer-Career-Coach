"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.disconnectDB = exports.connectDB = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
const logger_1 = require("./logger");
const connectDB = async () => {
    mongoose_1.default.set('strictQuery', true);
    mongoose_1.default.connection.on('connected', () => logger_1.logger.info('✅ Mongoose connected to MongoDB Atlas'));
    mongoose_1.default.connection.on('error', (err) => {
        logger_1.logger.error('❌ Mongoose connection error:', err.message);
        if (err.message.includes('authentication failed')) {
            logger_1.logger.error('👉 TIP: Check your MONGO_URI username and password.');
        }
        else if (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
            logger_1.logger.error('👉 TIP: Check if 0.0.0.0/0 is whitelisted in MongoDB Atlas Network Access.');
        }
    });
    mongoose_1.default.connection.on('disconnected', () => logger_1.logger.warn('Mongoose disconnected'));
    await mongoose_1.default.connect(env_1.config.MONGO_URI, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10000, // Increased to 10s for slow cold starts
        socketTimeoutMS: 45000,
        family: 4, // Force IPv4 to avoid some Railway/Atlas resolution issues
    });
};
exports.connectDB = connectDB;
const disconnectDB = async () => {
    await mongoose_1.default.disconnect();
};
exports.disconnectDB = disconnectDB;
//# sourceMappingURL=database.js.map