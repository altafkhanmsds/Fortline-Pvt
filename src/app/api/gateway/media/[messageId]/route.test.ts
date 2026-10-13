import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  supabaseAdmin: vi.fn(),
  getGatewayConfig: vi.fn(),
  gatewayFetch: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

vi.mock('@/lib/gateway/config', () => ({
  getGatewayConfig: mocks.getGatewayConfig,
  gatewayFetch: mocks.gatewayFetch,
}));

import { GET } from './route';

describe('GET /api/gateway/media/[messageId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getCurrentAccount.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'ceo-user-1',
      role: 'owner',
    });

    mocks.getGatewayConfig.mockResolvedValue({
      gateway_url: 'http://127.0.0.1:8080',
      api_key: 'test-secret-key',
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    mocks.getCurrentAccount.mockRejectedValueOnce(new Error('Unauthorized'));

    const req = new Request('http://localhost:3000/api/gateway/media/msg-1');
    const res = await GET(req, { params: Promise.resolve({ messageId: 'msg-1' }) });

    expect(res.status).toBe(401);
  });

  it('rejects cross-account access with 403', async () => {
    const mockMessage = {
      id: 'msg-cross',
      message_id: 'wa-msg-cross',
      media_type: 'image',
      conversation: { account_id: 'acct-other' },
    };

    mocks.supabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockMessage, error: null }),
          }),
        }),
      }),
    });

    const req = new Request('http://localhost:3000/api/gateway/media/msg-cross');
    const res = await GET(req, { params: Promise.resolve({ messageId: 'msg-cross' }) });

    expect(res.status).toBe(403);
  });

  it('routes correctly using message metadata.evolutionInstance and returns decrypted image buffer', async () => {
    const mockImageBase64 = Buffer.from('fake-image-bytes').toString('base64');
    const mockMessage = {
      id: 'msg-img-1',
      message_id: 'wa-img-1',
      media_type: 'image',
      conversation: { account_id: 'acct-1' },
      metadata: {
        evolutionInstance: 'rep_sarah_instance',
        rawMessage: {
          imageMessage: {
            url: 'https://mmg.whatsapp.net/test.enc',
            mimetype: 'image/jpeg',
          },
        },
      },
    };

    mocks.supabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockMessage, error: null }),
          }),
        }),
      }),
    });

    mocks.gatewayFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ base64: mockImageBase64, mimetype: 'image/jpeg' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const req = new Request('http://localhost:3000/api/gateway/media/msg-img-1');
    const res = await GET(req, { params: Promise.resolve({ messageId: 'msg-img-1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');

    // Verify it called Evolution API with the exact instance name
    expect(mocks.gatewayFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080',
      '/chat/getBase64FromMediaMessage/rep_sarah_instance',
      expect.anything()
    );

    const arrayBuffer = await res.arrayBuffer();
    expect(Buffer.from(arrayBuffer).toString()).toBe('fake-image-bytes');
  });

  it('routes video messages and supports HTTP Range 206 Partial Content requests', async () => {
    const fullVideoBytes = Buffer.from('0123456789abcdefghij');
    const mockVideoBase64 = fullVideoBytes.toString('base64');

    const mockMessage = {
      id: 'msg-video-1',
      message_id: 'wa-video-1',
      media_type: 'video',
      conversation: { account_id: 'acct-1' },
      metadata: {
        evolutionInstance: 'rep_bilal_instance',
        rawMessage: {
          videoMessage: {
            url: 'https://mmg.whatsapp.net/video.enc',
            mimetype: 'video/mp4',
          },
        },
      },
    };

    mocks.supabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockMessage, error: null }),
          }),
        }),
      }),
    });

    mocks.gatewayFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ base64: mockVideoBase64, mimetype: 'video/mp4' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const req = new Request('http://localhost:3000/api/gateway/media/msg-video-1', {
      headers: {
        Range: 'bytes=0-9',
      },
    });

    const res = await GET(req, { params: Promise.resolve({ messageId: 'msg-video-1' }) });

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-9/${fullVideoBytes.length}`);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');

    const chunk = await res.arrayBuffer();
    expect(Buffer.from(chunk).toString()).toBe('0123456789');
  });

  it('does NOT return JPEG image fallback when video decryption fails', async () => {
    const mockMessage = {
      id: 'msg-video-fail',
      message_id: 'wa-video-fail',
      media_type: 'video',
      conversation: { account_id: 'acct-1' },
      metadata: {
        evolutionInstance: 'rep_fail_instance',
        rawMessage: {
          videoMessage: {
            url: 'https://mmg.whatsapp.net/video.enc',
            mimetype: 'video/mp4',
            jpegThumbnail: 'data:image/jpeg;base64,tinythumbnail',
          },
        },
      },
    };

    mocks.supabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockMessage, error: null }),
          }),
        }),
      }),
    });

    mocks.gatewayFetch.mockResolvedValue(
      new Response('Evolution error', {
        status: 500,
      })
    );

    const req = new Request('http://localhost:3000/api/gateway/media/msg-video-fail');
    const res = await GET(req, { params: Promise.resolve({ messageId: 'msg-video-fail' }) });

    // Must return error status and NOT a 200 JPEG thumbnail
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeDefined();
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('serves documents with Content-Disposition inline and filename', async () => {
    const mockDocBase64 = Buffer.from('%PDF-1.4 test document').toString('base64');
    const mockMessage = {
      id: 'msg-doc-1',
      message_id: 'wa-doc-1',
      media_type: 'document',
      conversation: { account_id: 'acct-1' },
      content: '[Document: Proposal.pdf]',
      metadata: {
        evolutionInstance: 'rep_doc_instance',
        rawMessage: {
          documentMessage: {
            fileName: 'Proposal.pdf',
            mimetype: 'application/pdf',
          },
        },
      },
    };

    mocks.supabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockMessage, error: null }),
          }),
        }),
      }),
    });

    mocks.gatewayFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ base64: mockDocBase64, mimetype: 'application/pdf' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const req = new Request('http://localhost:3000/api/gateway/media/msg-doc-1');
    const res = await GET(req, { params: Promise.resolve({ messageId: 'msg-doc-1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('Proposal.pdf');
  });

  it('does NOT silently fall back to jpegThumbnail when image decryption fails', async () => {
    const mockMessage = {
      id: 'msg-img-fail',
      message_id: 'wa-img-fail',
      media_type: 'image',
      conversation: { account_id: 'acct-1' },
      metadata: {
        evolutionInstance: 'rep_fail_instance',
        rawMessage: {
          imageMessage: {
            url: 'https://mmg.whatsapp.net/img.enc',
            mimetype: 'image/jpeg',
            jpegThumbnail: 'data:image/jpeg;base64,tinythumbnail',
          },
        },
      },
    };

    mocks.supabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockMessage, error: null }),
          }),
        }),
      }),
    });

    mocks.gatewayFetch.mockResolvedValue(
      new Response('Evolution error', {
        status: 502,
      })
    );

    const req = new Request('http://localhost:3000/api/gateway/media/msg-img-fail');
    const res = await GET(req, { params: Promise.resolve({ messageId: 'msg-img-fail' }) });

    // Must return 502 and NOT 200 with the thumbnail
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('Full media unavailable from WhatsApp gateway');
  });
});
