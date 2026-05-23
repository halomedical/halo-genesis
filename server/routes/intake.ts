import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { resolveVpsJwt } from '../services/vpsApi';
import { config } from '../config';

const router = Router();
router.use(requireAuth);

// POST /api/intake/bundle
// Receives a multipart bundle from the browser, forwards it verbatim to the VPS
// process-bundle endpoint with the user's JWT, then pipes the SSE stream back.
// No business logic — thin authenticated proxy only.
router.post('/bundle', async (req: Request, res: Response) => {
  try {
    const contentType = req.headers['content-type'];
    if (!contentType?.startsWith('multipart/form-data')) {
      res.status(400).json({ error: 'multipart/form-data required' });
      return;
    }

    const vpsJwt = await resolveVpsJwt(req);

    // Buffer raw multipart body — boundary in Content-Type is preserved verbatim
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);

    const vpsRes = await fetch(`${config.vpsBaseUrl}/agent/process-bundle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vpsJwt}`, 'Content-Type': contentType },
      body,
    });

    if (!vpsRes.ok) {
      const errText = await vpsRes.text().catch(() => '');
      console.error(`[Intake] VPS process-bundle ${vpsRes.status}: ${errText}`);
      res.status(502).json({ error: 'Bundle processing failed. Please retry.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = vpsRes.body?.getReader();
    if (!reader) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
  } catch (err) {
    console.error('[Intake] Bundle error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Bundle failed. Please retry.' });
    } else {
      res.write(`data: ${JSON.stringify({ status: 'error', message: 'Connection lost.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

export default router;
