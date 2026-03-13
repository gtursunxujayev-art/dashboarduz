
// Background worker services

// These process jobs from Redis queues

import { prisma } from '@dashboarduz/db';
import { queueService } from '../services/queue';
import { log, LogLevel } from '../services/observability';
import { amocrmService } from '../services/integrations/amocrm';
import { telegramService } from '../services/integrations/telegram';
import { createVoIPService } from '../services/integrations/voip';

// Webhook processing worker
export async function processWebhookEvent(eventId: string) {
  try {
    log(LogLevel.INFO, 'Processing webhook event', { eventId });

    // Fetch event from database
    const event = await prisma.webhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error(`Webhook event ${eventId} not found`);
    }

    if (event.processed) {
      log(LogLevel.WARN, 'Webhook event already processed', { eventId });
      return;
    }

    // Determine tenant from event
    let tenantId = event.tenantId;
    
    if (!tenantId && event.source === 'amocrm') {
      // Try to determine tenant from AmoCRM account ID
      const payload = event.rawPayload as any;
      const accountId = payload.account?.id;
      
      if (accountId) {
        // Find integration with this account ID
        const integration = await prisma.integration.findFirst({
          where: {
            type: 'amocrm',
            config: {
              path: ['account_id'],
              equals: accountId,
            },
          },
        });
        
        if (integration) {
          tenantId = integration.tenantId;
        }
      }
    }

    if (!tenantId) {
      log(LogLevel.WARN, 'Cannot determine tenant for webhook event', { eventId, source: event.source });
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          processed: true,
          errorMessage: 'Cannot determine tenant',
        },
      });
      return;
    }

    // Process based on source
    switch (event.source) {
      case 'amocrm':
        await processAmoCRMWebhook(event, tenantId);
        break;
      case 'utel':
        await processUTeLWebhook(event, tenantId);
        break;
      case 'telegram':
        await processTelegramWebhook(event, tenantId);
        break;
      default:
        log(LogLevel.WARN, 'Unknown webhook source', { eventId, source: event.source });
    }

    // Mark as processed
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        processed: true,
        processedAt: new Date(),
      },
    });

    log(LogLevel.INFO, 'Webhook event processed successfully', { eventId, tenantId });
  } catch (error: any) {
    log(LogLevel.ERROR, 'Webhook processing failed', {
      eventId,
      error: error.message,
      stack: error.stack,
    });

    // Update event with error
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        errorMessage: error.message,
        retryCount: { increment: 1 },
      },
    });

    throw error;
  }
}

async function processAmoCRMWebhook(event: any, tenantId: string) {
  const payload = event.rawPayload as any;
  
  // Process leads
  if (payload.leads) {
    for (const leadData of payload.leads) {
      await prisma.lead.upsert({
        where: {
          amocrmId: String(leadData.id),
        },
        update: {
          title: leadData.name || 'Untitled Lead',
          status: leadData.status_id ? String(leadData.status_id) : null,
          metadata: leadData,
          updatedAt: new Date(),
        },
        create: {
          tenantId,
          amocrmId: String(leadData.id),
          title: leadData.name || 'Untitled Lead',
          status: leadData.status_id ? String(leadData.status_id) : null,
          metadata: leadData,
          source: 'amocrm',
        },
      });
    }
  }

  // Process contacts
  if (payload.contacts) {
    for (const contactData of payload.contacts) {
      const phone = contactData.phone?.[0]?.value;
      const email = contactData.email?.[0]?.value;

      if (phone || email) {
        // Find existing contact or create new
        const existingContact = await prisma.contact.findFirst({
          where: {
            tenantId,
            phone: phone || undefined,
            email: email || undefined,
          },
        });

        if (existingContact) {
          await prisma.contact.update({
            where: { id: existingContact.id },
            data: {
              name: contactData.name || existingContact.name,
              email: email || existingContact.email,
              externalIds: { amocrm_id: String(contactData.id) },
              metadata: contactData,
              updatedAt: new Date(),
            },
          });
        } else {
          await prisma.contact.create({
            data: {
              tenantId,
              name: contactData.name || null,
              phone: phone || null,
              email: email || null,
              externalIds: { amocrm_id: String(contactData.id) },
              metadata: contactData,
            },
          });
        }
      }
    }
  }
}

async function processUTeLWebhook(event: any, tenantId: string) {
  const payload = event.rawPayload as any;
  
  // Create call record
  await prisma.call.create({
    data: {
      tenantId,
      callIdExternal: payload.call_id || `utel-${Date.now()}`,
      from: payload.from,
      to: payload.to,
      direction: payload.direction || 'inbound',
      status: payload.status || 'completed',
      duration: payload.duration,
      recordingUrl: payload.recording_url,
      recordingId: payload.recording_id,
      metadata: payload,
      startedAt: new Date(payload.start_time || Date.now()),
      endedAt: payload.end_time ? new Date(payload.end_time) : null,
    },
  });

  // Try to link to lead if phone number matches
  if (payload.from || payload.to) {
    const contact = await prisma.contact.findFirst({
      where: {
        tenantId,
        phone: { in: [payload.from, payload.to] },
      },
      include: { leads: true },
    });

    if (contact && contact.leads.length > 0) {
      const firstLead = contact.leads[0];
      if (!firstLead) {
        return;
      }
      await prisma.call.updateMany({
        where: {
          tenantId,
          callIdExternal: payload.call_id,
        },
        data: {
          contactId: contact.id,
          leadId: firstLead.id,
        },
      });
    }
  }
}

async function processTelegramWebhook(event: any, tenantId: string) {
  const payload = event.rawPayload as any;
  
  // Process Telegram messages/updates
  // This would handle bot commands, messages, etc.
  log(LogLevel.INFO, 'Processing Telegram webhook', { tenantId, updateId: payload.update_id });
  
  // Create notification if needed
  if (payload.message) {
    await queueService.addNotificationJob(`telegram-${payload.update_id}`);
  }
}

// Notification worker
export async function processNotification(notificationId: string) {
  try {
    log(LogLevel.INFO, 'Processing notification', { notificationId });

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new Error(`Notification ${notificationId} not found`);
    }

    if (notification.status === 'sent') {
      log(LogLevel.WARN, 'Notification already sent', { notificationId });
      return;
    }

    // Get integration for the notification type
    const integration = await prisma.integration.findFirst({
      where: {
        tenantId: notification.tenantId,
        type: notification.type === 'telegram' ? 'telegram' : undefined,
        status: 'active',
      },
    });

    if (!integration) {
      throw new Error(`No active ${notification.type} integration found`);
    }

    // Send notification based on type
    switch (notification.type) {
      case 'telegram':
        await sendTelegramNotification(notification, integration);
        break;
      case 'email':
        await sendEmailNotification(notification);
        break;
      case 'sms':
        await sendSMSNotification(notification);
        break;
      default:
        throw new Error(`Unknown notification type: ${notification.type}`);
    }

    // Update notification status
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    log(LogLevel.INFO, 'Notification sent successfully', { notificationId });
    } catch (error: any) {
    log(LogLevel.ERROR, 'Notification processing failed', {
      notificationId,
      error: error.message,
      stack: error.stack,
    });

    // Fetch notification again for error handling
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new Error(`Notification ${notificationId} not found during error handling`);
    }

    // Update notification with error
    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        attempts: { increment: 1 },
        errorMessage: error.message,
        status: notification.attempts + 1 >= notification.maxAttempts ? 'failed' : 'retrying',
        nextRetryAt: notification.attempts + 1 < notification.maxAttempts 
          ? new Date(Date.now() + Math.pow(2, notification.attempts) * 1000)
          : null,
      },
    });

    // Re-queue if not at max attempts
    if (updated.status === 'retrying' && updated.nextRetryAt) {
      await queueService.addNotificationJob(notificationId, {
        delay: updated.nextRetryAt.getTime() - Date.now(),
      });
    }

    throw error;
  }
}

async function sendTelegramNotification(notification: any, integration: any) {
  const payload = notification.payload as any;
  const botToken = (integration.config as any)?.botToken;
  
  if (!botToken) {
    throw new Error('Telegram bot token not found');
  }

  await telegramService.sendMessage(
    botToken,
    payload.chatId,
    payload.text,
    payload.options
  );
}

async function sendEmailNotification(notification: any) {
  // TODO: Implement email sending (SendGrid, SES, etc.)
  log(LogLevel.WARN, 'Email notification not implemented', { notificationId: notification.id });
  throw new Error('Email notification not implemented');
}

async function sendSMSNotification(notification: any) {
  // TODO: Implement SMS sending (Twilio, etc.)
  log(LogLevel.WARN, 'SMS notification not implemented', { notificationId: notification.id });
  throw new Error('SMS notification not implemented');
}

// Export worker
export async function processExport(exportId: string) {
  try {
    log(LogLevel.INFO, 'Processing export', { exportId });

    // TODO: Implement export generation
    // 1. Fetch export parameters
    // 2. Generate PDF or Excel
    // 3. Upload to S3
    // 4. Send download link via email/Telegram

    log(LogLevel.INFO, 'Export processed successfully', { exportId });
  } catch (error: any) {
    log(LogLevel.ERROR, 'Export processing failed', {
      exportId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

export async function processIntegrationSync(integrationType: string, tenantId: string) {
  const integration = await prisma.integration.findFirst({
    where: {
      tenantId,
      type: integrationType,
      status: 'active',
    },
  });

  if (!integration) {
    throw new Error(`Active integration not found for type=${integrationType}, tenant=${tenantId}`);
  }

  // Minimal MVP sync behavior: mark successful sync heartbeat.
  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      action: 'integration_sync',
      resource: 'integration',
      resourceId: integration.id,
      metadata: { type: integrationType },
    },
  });
}
