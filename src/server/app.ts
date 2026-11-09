import express, { Request, Response } from 'express';
import { verifyGitHubSignature } from '../github/verify.js';
import { parseAndDispatchGitHubEvent } from '../github/dispatcher.js';
import { broadcastGitHubEvent } from '../github/notifier.js';
import { store } from '../storage/store.js';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

export function createServer(): express.Express {
  const app = express();

  // Save raw body buffer for HMAC signature verification
  app.use(
    express.json({
      verify: (req: RequestWithRawBody, _res, buf) => {
        req.rawBody = buf;
      },
      limit: '10mb',
    })
  );

  // Health check endpoint
  app.get(['/', '/health'], (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'GitHub Telegram Bot',
      version: '1.0.0',
      activeChats: store.getAllChats().length,
      timestamp: new Date().toISOString(),
    });
  });

  // Main GitHub Webhook Endpoint
  app.post('/webhook', async (req: RequestWithRawBody, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const eventName = req.headers['x-github-event'] as string | undefined;
    const deliveryId = req.headers['x-github-delivery'] as string | undefined;

    if (!eventName) {
      res.status(400).json({ error: 'Missing X-GitHub-Event header' });
      return;
    }

    // Verify HMAC SHA-256 signature
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const isValid = verifyGitHubSignature(signature, rawBody);

    if (!isValid) {
      console.warn(`⚠️ Rejected unauthorized webhook delivery (${deliveryId}): Invalid signature`);
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    // Dispatch event
    try {
      const dispatched = parseAndDispatchGitHubEvent(eventName, req.body);

      if (!dispatched) {
        // Event not configured/supported, acknowledge receipt with 200 OK
        res.status(200).json({
          status: 'ignored',
          event: eventName,
          reason: 'Event type not tracked',
        });
        return;
      }

      const deliveredCount = await broadcastGitHubEvent(dispatched);

      res.status(200).json({
        status: 'success',
        event: eventName,
        repository: dispatched.repoFullName,
        deliveredToChats: deliveredCount,
      });
    } catch (err: any) {
      console.error(`Error processing webhook event "${eventName}":`, err);
      res.status(500).json({
        status: 'error',
        message: err.message || 'Internal server error',
      });
    }
  });

  return app;
}
