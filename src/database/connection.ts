import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export const connectDatabase = async (): Promise<void> => {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        logger.warn('⚠️ MONGO_URI not set, skipping database connection');
        return;
    }
    try {
        await mongoose.connect(mongoUri);
        logger.info('✅ MongoDB connected successfully');
    } catch (error) {
        logger.error('❌ MongoDB connection error:', error);
        // MongoDB ulanmasa ham bot ishlayveradi
        logger.warn('⚠️ Bot MongoDB siz davom etmoqda (blocking feature ishlamaydi)');
    }
};
