import { describe, expect, it } from 'vitest';
import {
  createTranslator,
  dictionaries,
  effectiveLocale,
  normalizeLocale,
  translate,
} from '@/i18n';
import { identityDisplayRows, recordingModeLabel } from '@/identity/display';
import { recordingActivityNotice } from '@/reliability/status';
import {
  buildUploadQueueStats,
  uploadQueueChunkDetail,
  uploadQueueChunkLabel,
} from '@/upload/queue';
import type { IdentityBundle, RecordingRow } from '@/shared/types';

describe('i18n', () => {
  it('keeps English and Chinese dictionaries aligned', () => {
    expect(Object.keys(dictionaries['zh-CN']).sort()).toEqual(
      Object.keys(dictionaries.en).sort()
    );
  });

  it('normalizes browser locales and honors explicit preference', () => {
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(
      effectiveLocale('auto', {
        language: 'en-US',
        languages: ['zh-CN', 'en-US'],
      } as Pick<Navigator, 'language' | 'languages'>)
    ).toBe('zh-CN');
    expect(
      effectiveLocale('en', {
        language: 'zh-CN',
        languages: ['zh-CN'],
      } as Pick<Navigator, 'language' | 'languages'>)
    ).toBe('en');
  });

  it('interpolates translated operational copy', () => {
    expect(translate('en', 'queue.chunkUploaded', { uploaded: 2, total: 4 })).toBe(
      '2/4 chunks uploaded'
    );
    expect(
      translate('zh-CN', 'queue.chunkUploaded', { uploaded: 2, total: 4 })
    ).toBe('已上传 2/4 个分块');
  });

  it('localizes shared display models with English defaults', () => {
    const zh = createTranslator('zh-CN');
    expect(recordingModeLabel('research_free_form')).toEqual({
      label: 'Research collection',
      detail: 'Uses generated disposable identity and test payment data.',
    });
    expect(recordingModeLabel('research_free_form', zh)).toEqual({
      label: '研究采集',
      detail: '使用生成的一次性身份和测试支付数据。',
    });
    expect(
      recordingActivityNotice(
        { active: true, traceId: 'tr_i18n', recovered: true },
        zh
      )
    ).toMatchObject({
      title: '已恢复活动录制',
      detail: '录制 tr_i18n 已在重启后恢复。请正常继续，或在用户旅程完成后停止录制。',
    });
  });

  it('localizes identity and queue labels', () => {
    const zh = createTranslator('zh-CN');
    expect(identityDisplayRows(identity, zh).slice(0, 4)).toEqual([
      { group: '凭据', label: '邮箱', value: 'operator@example.test', copyable: true },
      {
        group: '凭据',
        label: '密码',
        value: 'generated-password',
        copyable: true,
        secret: true,
      },
      {
        group: '凭据',
        label: '网页登录邮箱',
        value: 'https://mail.example.test/user/login',
        copyable: true,
        href: 'https://mail.example.test/user/login',
      },
      { group: '凭据', label: '过期时间', value: '2026-06-04T00:00:00.000Z' },
    ]);

    const stats = buildUploadQueueStats(recording(), undefined);
    expect(uploadQueueChunkLabel(stats, zh)).toBe('暂无清单');
    expect(uploadQueueChunkDetail(stats, zh)).toBe('上传开始后将生成清单。');
  });
});

const identity: IdentityBundle = {
  identity_bundle_id: 'idb_i18n',
  email: 'operator@example.test',
  email_password: 'generated-password',
  webmail_url: 'https://mail.example.test/user/login',
  persona: {
    name: 'Alex Green',
  },
  payment: {
    enabled: true,
  },
  expires_at: '2026-06-04T00:00:00.000Z',
};

function recording(): RecordingRow {
  return {
    trace_id: 'tr_i18n',
    status: 'queued',
    created_at: 1,
    updated_at: 2,
    envelope: {
      schema_version: 'journey_trace_v1',
      trace_id: 'tr_i18n',
      recording_mode: 'research_free_form',
      started_at: '2026-06-05T00:00:00.000Z',
      tags: [],
      browser: {
        extension_version: '0.1.0',
        user_agent: 'vitest',
        timezone: 'UTC',
      },
      summary: {
        domains: [],
        duration_ms: 0,
        event_counts: {},
        screenshot_count: 0,
        video_chunk_count: 0,
      },
    },
  };
}
