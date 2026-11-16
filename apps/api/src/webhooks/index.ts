import express from 'express';

import { amocrmWebhookRouter } from './amocrm';
import { faceIdWebhookRouter } from './faceid';
import { telegramWebhookRouter } from './telegram';
import { voipWebhookRouter } from './voip';

// One router per webhook source, mounted in the order the routes were registered before the split.
const router = express.Router();

router.use(amocrmWebhookRouter);
router.use(voipWebhookRouter);
router.use(telegramWebhookRouter);
router.use(faceIdWebhookRouter);

export default router;
