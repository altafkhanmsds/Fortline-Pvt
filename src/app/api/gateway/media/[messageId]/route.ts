import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getCurrentAccount } from '@/lib/auth/account';
import { getGatewayConfig, gatewayFetch } from '@/lib/gateway/config';

function normalizeProtoMessage(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  let unwrapped = raw;
  if (unwrapped.ephemeralMessage?.message) unwrapped = unwrapped.ephemeralMessage.message;
  if (unwrapped.viewOnceMessage?.message) unwrapped = unwrapped.viewOnceMessage.message;
  if (unwrapped.viewOnceMessageV2?.message) unwrapped = unwrapped.viewOnceMessageV2.message;
  if (unwrapped.documentWithCaptionMessage?.message) unwrapped = unwrapped.documentWithCaptionMessage.message;

  const cleaned: any = { ...unwrapped };
  for (const mediaKey of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
    if (cleaned[mediaKey] && typeof cleaned[mediaKey] === 'object') {
      cleaned[mediaKey] = { ...cleaned[mediaKey] };
      const m = cleaned[mediaKey];
      if (m.fileLength && typeof m.fileLength === 'object' && 'low' in m.fileLength) {
        m.fileLength = m.fileLength.low;
      }
    }
  }
  return cleaned;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ messageId: string }> | { messageId: string } }
) {
  try {
    // 1. Authenticated CRM access check
    let userAccount: any = null;
    try {
      userAccount = await getCurrentAccount();
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(context.params);
    const { messageId } = resolvedParams;

    if (!messageId) {
      return NextResponse.json({ error: 'Message ID is required' }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // 2. Locate message in DB by UUID or WhatsApp message_id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId);
    let msgQuery = admin.from('messages').select('*, conversation:conversations(*, contact:contacts(*))');

    if (isUuid) {
      msgQuery = msgQuery.or(`id.eq.${messageId},message_id.eq.${messageId}`);
    } else {
      msgQuery = msgQuery.eq('message_id', messageId);
    }

    const { data: msg, error: msgErr } = await msgQuery.maybeSingle();

    if (msgErr || !msg) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Multi-tenant check: ensure message belongs to caller's account
    if (
      userAccount?.accountId &&
      msg.conversation?.account_id &&
      msg.conversation.account_id !== userAccount.accountId
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // 3. If stored media is already a full base64 data URL (e.g. from local tests or internal cache)
    if (msg.media_url && msg.media_url.startsWith('data:')) {
      const match = msg.media_url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mime = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        return serveMediaBuffer(buffer, mime, request);
      }
    }

    // 4. Instance Routing:
    // Resolve the exact WhatsApp/Evolution instance associated with this message/channel
    let instanceName: string | null = null;

    // A. Direct instance recorded in message metadata by Evolution webhook
    if (typeof msg.metadata?.evolutionInstance === 'string' && msg.metadata.evolutionInstance.trim()) {
      instanceName = msg.metadata.evolutionInstance.trim();
    }

    // B. Direct channel relation on the message
    if (!instanceName && msg.whatsapp_channel_id) {
      const { data: ch } = await admin
        .from('fortline_channels')
        .select('gateway_instance_id')
        .eq('id', msg.whatsapp_channel_id)
        .maybeSingle();
      if (ch?.gateway_instance_id) instanceName = ch.gateway_instance_id;
    }

    // C. Channel relation on the parent conversation
    if (!instanceName && msg.conversation?.whatsapp_channel_id) {
      const { data: ch } = await admin
        .from('fortline_channels')
        .select('gateway_instance_id')
        .eq('id', msg.conversation.whatsapp_channel_id)
        .maybeSingle();
      if (ch?.gateway_instance_id) instanceName = ch.gateway_instance_id;
    }

    // D. Sales member mapping on message or conversation
    const salesMemberId =
      msg.sales_member_id ||
      msg.sales_rep_id ||
      msg.conversation?.assigned_sales_member_id;

    if (!instanceName && salesMemberId) {
      const { data: ch } = await admin
        .from('fortline_channels')
        .select('gateway_instance_id')
        .eq('sales_member_id', salesMemberId)
        .maybeSingle();
      if (ch?.gateway_instance_id) instanceName = ch.gateway_instance_id;
    }

    // E. Phone number ID mapping
    const phoneNumId =
      msg.channel_phone_number_id ||
      msg.conversation?.channel_phone_number_id;

    if (!instanceName && phoneNumId) {
      const { data: ch } = await admin
        .from('fortline_channels')
        .select('gateway_instance_id')
        .eq('phone_number_id', phoneNumId)
        .maybeSingle();
      if (ch?.gateway_instance_id) instanceName = ch.gateway_instance_id;
    }

    if (!instanceName) {
      return NextResponse.json(
        { error: 'No associated WhatsApp gateway instance found for this message' },
        { status: 404 }
      );
    }

    // 5. Gateway configuration
    const accountId = msg.conversation?.account_id || userAccount?.accountId || null;
    const gatewayConfig = await getGatewayConfig(admin, accountId);

    // 6. Decrypt media via Evolution API
    const waMessageId = msg.message_id || messageId;
    const rawMsg = msg.metadata?.rawMessage || msg.metadata?.message;
    const cleanRawMsg = normalizeProtoMessage(rawMsg);

    const hasMediaProto = Boolean(
      cleanRawMsg?.imageMessage ||
      cleanRawMsg?.videoMessage ||
      cleanRawMsg?.audioMessage ||
      cleanRawMsg?.documentMessage ||
      cleanRawMsg?.stickerMessage
    );

    const remoteJid =
      msg.metadata?.remoteJid ||
      msg.metadata?.key?.remoteJid ||
      (msg.conversation?.contact?.phone
        ? (msg.conversation.contact.phone.includes('@')
            ? msg.conversation.contact.phone
            : `${msg.conversation.contact.phone.replace(/^\+/, '')}@s.whatsapp.net`)
        : undefined);

    const isFromMe = Boolean(
      msg.metadata?.fromMe ??
      msg.metadata?.key?.fromMe ??
      (msg.sender_type === 'user')
    );

    const cleanKey = {
      id: waMessageId,
      fromMe: isFromMe,
      remoteJid,
      ...(msg.metadata?.key?.participant ? { participant: msg.metadata.key.participant } : {}),
    };

    let messageRecord: any = null;

    // If we don't have the media protobuf locally, query Evolution API to retrieve the message record
    if (!hasMediaProto) {
      try {
        const findRes = await gatewayFetch(
          gatewayConfig.gateway_url,
          `/chat/findMessages/${encodeURIComponent(instanceName)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: gatewayConfig.api_key,
            },
            body: JSON.stringify({
              where: {
                key: {
                  id: waMessageId,
                },
              },
            }),
          }
        );

        if (findRes.ok) {
          const findData = await findRes.json();
          const records = findData?.messages?.records || (Array.isArray(findData) ? findData : []);
          if (records.length > 0) {
            messageRecord = records[0];
          }
        }
      } catch (e: any) {
        console.warn('[gateway-media] Error finding message in Evolution API:', e.message);
      }

      // Fallback query by remoteJid if message id lookup was empty
      if (!messageRecord && remoteJid) {
        try {
          const findRes = await gatewayFetch(
            gatewayConfig.gateway_url,
            `/chat/findMessages/${encodeURIComponent(instanceName)}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: gatewayConfig.api_key,
              },
              body: JSON.stringify({
                where: {
                  key: {
                    remoteJid,
                  },
                },
                take: 50,
              }),
            }
          );

          if (findRes.ok) {
            const findData = await findRes.json();
            const records = findData?.messages?.records || (Array.isArray(findData) ? findData : []);
            messageRecord = records.find((r: any) => r.key?.id === waMessageId) || null;
          }
        } catch {
          // Ignore fallback search error
        }
      }
    }

    const mediaPayload = messageRecord
      ? { message: messageRecord, convertToMp4: false }
      : {
          message: {
            key: cleanKey,
            message: cleanRawMsg,
          },
          convertToMp4: false,
        };

    let evoRes: Response | null = null;
    const endpointsToTry = [
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      `/message/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
    ];

    for (const endpoint of endpointsToTry) {
      try {
        evoRes = await gatewayFetch(
          gatewayConfig.gateway_url,
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: gatewayConfig.api_key,
            },
            body: JSON.stringify(mediaPayload),
          }
        );

        if (evoRes.ok) {
          break;
        }
      } catch (e: any) {
        console.warn(`[gateway-media] Network error contacting Evolution API (${endpoint}):`, e.message);
      }
    }

    // If initial decrypt failed and we hadn't queried findMessages yet, try findMessages as fallback
    if ((!evoRes || !evoRes.ok) && hasMediaProto) {
      try {
        const findRes = await gatewayFetch(
          gatewayConfig.gateway_url,
          `/chat/findMessages/${encodeURIComponent(instanceName)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: gatewayConfig.api_key,
            },
            body: JSON.stringify({
              where: {
                key: {
                  id: waMessageId,
                },
              },
            }),
          }
        );

        if (findRes.ok) {
          const findData = await findRes.json();
          const records = findData?.messages?.records || (Array.isArray(findData) ? findData : []);
          const fetchedRec = records.find((r: any) => r.key?.id === waMessageId) || records[0];
          if (fetchedRec) {
            evoRes = await gatewayFetch(
              gatewayConfig.gateway_url,
              `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: gatewayConfig.api_key,
                },
                body: JSON.stringify({ message: fetchedRec, convertToMp4: false }),
              }
            );
          }
        }
      } catch {
        // Ignore fallback error
      }
    }

    if (!evoRes || !evoRes.ok) {
      const errText = evoRes ? await evoRes.text().catch(() => '') : 'Unreachable';
      console.warn('[gateway-media] Evolution API media error:', evoRes?.status, errText);

      // REQUIREMENT 6: DO NOT silently return thumbnail! Fail clearly so UI shows retry
      return NextResponse.json(
        { error: 'Full media unavailable from WhatsApp gateway' },
        { status: evoRes?.status || 502 }
      );
    }

    const evoData = await evoRes.json();
    let base64Str = evoData?.base64 || evoData?.dataUrl;

    if (!base64Str) {
      return NextResponse.json(
        { error: 'No media content returned by WhatsApp gateway' },
        { status: 502 }
      );
    }

    if (base64Str.startsWith('data:')) {
      const commaIdx = base64Str.indexOf(',');
      if (commaIdx !== -1) {
        base64Str = base64Str.slice(commaIdx + 1);
      }
    }

    const buffer = Buffer.from(base64Str, 'base64');
    let mime = evoData.mimetype;
    if (!mime) {
      mime =
        msg.media_mime_type ||
        cleanRawMsg?.imageMessage?.mimetype ||
        cleanRawMsg?.videoMessage?.mimetype ||
        cleanRawMsg?.audioMessage?.mimetype ||
        cleanRawMsg?.documentMessage?.mimetype;
    }
    if (!mime) {
      if (msg.media_type === 'audio') mime = 'audio/ogg; codecs=opus';
      else if (msg.media_type === 'image') mime = 'image/jpeg';
      else if (msg.media_type === 'video') mime = 'video/mp4';
      else if (msg.media_type === 'document') mime = 'application/pdf';
      else mime = 'application/octet-stream';
    }

    // Safe diagnostic log per Requirement 4 (never logging keys, base64 or secrets)
    console.log('[MEDIA PROXY]', {
      messageId: msg.id,
      instanceName,
      mimeType: mime,
      source: 'EVOLUTION_DECRYPTED_MEDIA',
      bytes: buffer.length,
    });

    // Extract filename for document Content-Disposition
    const docFileName =
      cleanRawMsg?.documentMessage?.fileName ||
      msg.metadata?.fileName ||
      (typeof msg.content === 'string' && msg.content.startsWith('[Document: ')
        ? msg.content.replace(/^\[Document:\s*/, '').replace(/\]$/, '').trim()
        : undefined);

    return serveMediaBuffer(buffer, mime, request, docFileName);
  } catch (err: any) {
    console.error('[gateway-media] Exception:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

function serveMediaBuffer(
  buffer: Buffer,
  mime: string,
  request: Request,
  filename?: string
): Response {
  const contentDisposition = filename
    ? `inline; filename="${encodeURIComponent(filename)}"`
    : 'inline';

  // Support HTTP Range requests so <video> and <audio> elements can seek.
  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : buffer.length - 1;
      const clampedEnd = Math.min(end, buffer.length - 1);
      const chunk = buffer.subarray(start, clampedEnd + 1);

      return new Response(new Uint8Array(chunk), {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': chunk.length.toString(),
          'Content-Range': `bytes ${start}-${clampedEnd}/${buffer.length}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'Content-Disposition': contentDisposition,
        },
      });
    }
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': contentDisposition,
    },
  });
}
