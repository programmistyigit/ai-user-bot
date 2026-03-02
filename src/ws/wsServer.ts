import WebSocket, { WebSocketServer } from 'ws';
import { logger } from '../utils/logger';
import { config } from '../config';
import { EventEmitter } from 'events';

// WSS Event types
export interface NewClientPayload {
    userId: string;
    username?: string;
    lastMessage: string;
}

export interface ConnectionFailedPayload {
    userId: string;
}

export interface WsMessage {
    event: string;
    data: any;
}

class WsServerManager extends EventEmitter {
    private wss: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();

    /**
     * WSS serverni ishga tushirish
     */
    start(): void {
        const port = config.WS_PORT;

        this.wss = new WebSocketServer({ port });

        this.wss.on('listening', () => {
            logger.info(`🌐 WSS Server ishga tushdi port: ${port}`);
        });

        this.wss.on('connection', (ws: WebSocket) => {
            logger.info('🔗 WSS Client ulandi');
            this.clients.add(ws);

            ws.on('message', (raw: WebSocket.RawData) => {
                try {
                    const msg: WsMessage = JSON.parse(raw.toString());
                    logger.info(`📨 WSS Event qabul qilindi: ${msg.event}`);
                    this.handleMessage(msg, ws);
                } catch (err) {
                    logger.error('❌ WSS xabar parse xatosi:', err);
                }
            });

            ws.on('close', () => {
                logger.info('🔌 WSS Client uzildi');
                this.clients.delete(ws);
            });

            ws.on('error', (err) => {
                logger.error('❌ WSS Client xatosi:', err);
                this.clients.delete(ws);
            });

            // Ping/pong heartbeat
            ws.on('pong', () => {
                (ws as any).isAlive = true;
            });
            (ws as any).isAlive = true;
        });

        // Heartbeat interval
        const heartbeat = setInterval(() => {
            this.wss?.clients.forEach((ws) => {
                if ((ws as any).isAlive === false) {
                    ws.terminate();
                    return;
                }
                (ws as any).isAlive = false;
                ws.ping();
            });
        }, 30000);

        this.wss.on('close', () => {
            clearInterval(heartbeat);
        });
    }

    /**
     * Kelgan xabarni ishlov berish
     */
    private handleMessage(msg: WsMessage, _ws: WebSocket): void {
        switch (msg.event) {
            case 'newClient':
                this.emit('newClient', msg.data as NewClientPayload);
                break;
            default:
                logger.warn(`⚠️ Noma'lum WSS event: ${msg.event}`);
        }
    }

    /**
     * Barcha ulangan clientlarga event yuborish
     */
    broadcast(event: string, data: any): void {
        const message = JSON.stringify({ event, data });
        this.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        });
    }

    /**
     * connectionFailed eventini yuborish
     */
    sendConnectionFailed(userId: string): void {
        this.broadcast('connectionFailed', { userId } as ConnectionFailedPayload);
    }

    /**
     * Serverni to'xtatish
     */
    stop(): void {
        this.clients.forEach((ws) => ws.close());
        this.wss?.close();
        logger.info('🛑 WSS Server to\'xtatildi');
    }
}

export const wsServer = new WsServerManager();
