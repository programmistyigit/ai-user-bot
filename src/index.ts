import { startTelegramClient, client } from './telegram/client';
import { logger } from './utils/logger';
import { wsServer, NewClientPayload } from './ws/wsServer';
import { Api, helpers } from 'telegram';
import { aiHandler } from './ai/ollama';
import { getMessageText } from './services/aiUtils';
import { startControlBot, stopControlBot } from './bot/controlBot';

const start = async () => {
    logger.info('🚀 Starting AI User-Bot + WSS Server...');

    // Start Telegram Client
    await startTelegramClient();

    // Start WSS Server
    wsServer.start();

    // Start Control Bot
    startControlBot();

    // newClient event handler
    wsServer.on('newClient', async (payload: NewClientPayload) => {
        const { userId, username, lastMessage } = payload;
        logger.info(`📥 Yangi klient keldi WSS orqali: ${userId} (@${username || 'no_user'})`);
        logger.info(`💬 Oxirgi xabar: ${lastMessage}`);

        try {
            // Telegram orqali klientni topish
            let entity: any = null;

            // 1. ID orqali qidirish
            try {
                entity = await client.getEntity(userId);
                logger.info(`✅ Klient ID orqali topildi: ${userId}`);
            } catch (idError) {
                logger.warn(`⚠️ Klient ID orqali topilmadi: ${userId}`);

                // 2. Username orqali qidirish (agar bo'lsa)
                if (username) {
                    try {
                        entity = await client.getEntity(username);
                        logger.info(`✅ Klient Username orqali topildi: @${username}`);
                    } catch (userError) {
                        logger.error(`❌ Klient Username orqali ham topilmadi: @${username}`);
                    }
                }
            }

            if (!entity) {
                logger.error(`❌ Klientni topib bo'lmadi: ${userId} / @${username}`);
                wsServer.sendConnectionFailed(userId);
                return;
            }

            // Klientga DeepSeek V3 orqali javob generatsiya qilish
            const history = [
                { role: 'user' as const, content: lastMessage }
            ];

            const aiResponse = await aiHandler.generateResponse(history);

            if (!aiResponse || aiResponse.trim().length === 0) {
                logger.warn(`⚠️ AI bo'sh javob berdi, user: ${userId}`);
                wsServer.sendConnectionFailed(userId);
                return;
            }

            // Telegram orqali klientga yozish
            await client.sendMessage(entity, {
                message: aiResponse,
                parseMode: 'markdown'
            });

            logger.info(`✅ Klientga javob yuborildi: ${userId}`);

        } catch (error: any) {
            logger.error(`❌ Klientga yozib bo'lmadi (${userId}):`, error);
            wsServer.sendConnectionFailed(userId);
        }
    });

    logger.info('✨ Bot + WSS Server ishlayapti!');
};

// Graceful Shutdown
const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    try {
        wsServer.stop();
        stopControlBot();
        await client.disconnect();
        logger.info('Telegram Client disconnected.');

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
