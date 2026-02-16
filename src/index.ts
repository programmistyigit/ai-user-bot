import { connectDatabase } from './database/connection';
import { startTelegramClient, client } from './telegram/client';
import { logger } from './utils/logger';
import mongoose from 'mongoose';

const start = async () => {
    logger.info('🚀 Starting AI User-Bot...');

    // 1. Connect to Database
    await connectDatabase();

    // 2. Start Telegram Client
    await startTelegramClient();

    logger.info('✨ Bot is up and running!');
};

// Graceful Shutdown
const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    try {
        await client.disconnect();
        logger.info('Telegram Client disconnected.');

        await mongoose.disconnect();
        logger.info('MongoDB disconnected.');

        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
    }
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
    logger.error('❌ Fatal error during startup:', error);
    process.exit(1);
});
