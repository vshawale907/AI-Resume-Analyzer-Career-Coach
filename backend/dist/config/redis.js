"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cache = exports.getRedis = exports.connectRedis = exports.isRedisConnected = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./env");
const logger_1 = require("./logger");
let redisClient;
let isRedisHealthy = false;
const isRedisConnected = () => isRedisHealthy;
exports.isRedisConnected = isRedisConnected;
const connectRedis = async () => {
    try {
        redisClient = new ioredis_1.default(env_1.config.REDIS_URL, {
            maxRetriesPerRequest: 1, // Fail fast if Redis is down
            enableReadyCheck: false,
            lazyConnect: true,
            connectTimeout: 5000,
            retryStrategy: (times) => {
                if (times > 3) {
                    logger_1.logger.warn(`Redis connection retry limit reached (${times}). Giving up.`);
                    isRedisHealthy = false;
                    return null; // Stop retrying
                }
                return Math.min(times * 100, 2000);
            },
        });
        redisClient.on('connect', () => logger_1.logger.info('Redis connecting...'));
        redisClient.on('ready', () => {
            logger_1.logger.info('✅ Redis ready');
            isRedisHealthy = true;
        });
        redisClient.on('error', (err) => {
            logger_1.logger.error(`Redis error: ${err.message}`);
            isRedisHealthy = false;
        });
        redisClient.on('close', () => {
            logger_1.logger.warn('Redis connection closed');
            isRedisHealthy = false;
        });
        await redisClient.connect().catch(err => {
            logger_1.logger.error(`Initial Redis connection failed: ${err.message}`);
            isRedisHealthy = false;
        });
        return redisClient;
    }
    catch (err) {
        logger_1.logger.error(`Failed to initialize Redis client: ${err.message}`);
        isRedisHealthy = false;
        return null;
    }
};
exports.connectRedis = connectRedis;
const getRedis = () => {
    if (!redisClient) {
        logger_1.logger.warn('Redis not initialized. Initializing now with default URL.');
        // Fallback initialization if something calls getRedis before connectRedis
        redisClient = new ioredis_1.default(env_1.config.REDIS_URL, { lazyConnect: true });
    }
    return redisClient;
};
exports.getRedis = getRedis;
exports.cache = {
    get: async (key) => {
        if (!isRedisHealthy)
            return null;
        try {
            const data = await (0, exports.getRedis)().get(key);
            return data ? JSON.parse(data) : null;
        }
        catch {
            return null;
        }
    },
    set: async (key, value, ttlSeconds = 3600) => {
        if (!isRedisHealthy)
            return;
        try {
            await (0, exports.getRedis)().setex(key, ttlSeconds, JSON.stringify(value));
        }
        catch { /* ignore */ }
    },
    del: async (key) => {
        await (0, exports.getRedis)().del(key);
    },
    invalidatePattern: async (pattern) => {
        const keys = await (0, exports.getRedis)().keys(pattern);
        if (keys.length)
            await (0, exports.getRedis)().del(...keys);
    },
};
//# sourceMappingURL=redis.js.map