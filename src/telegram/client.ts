import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { config } from '../config';
import { logger } from '../utils/logger';
import input from 'input'; // For interactive login if needed
import { handleIncomingMessage } from '../services/messageHandler';

const stringSession = new StringSession(config.SESSION_STRING);

export const client = new TelegramClient(stringSession, config.API_ID, config.API_HASH, {
    connectionRetries: 5,
    deviceModel: 'AI menejer',
    systemVersion: '1.0.0',
    appVersion: '1.0.0',
    langCode: 'uz',

});

export const startTelegramClient = async () => {
    try {
        await client.start({
            phoneNumber: async () => await input.text('Please enter your number: '),
            password: async () => await input.text('Please enter your password: '),
            phoneCode: async () => await input.text('Please enter the code you received: '),
            onError: (err) => { logger.error('Telegram Client Error:', err); },
        });

        logger.info('✅ Telegram Client Connected!');
        logger.info(`Session String (Save this to .env): ${client.session.save()}`);

        client.addEventHandler(handleIncomingMessage, new NewMessage({ incoming: true }));
        logger.info('🎧 Event Handler Registered');
    } catch (error) {
        logger.error('❌ Failed to start Telegram Client:', error);
        process.exit(1);
    }
};
