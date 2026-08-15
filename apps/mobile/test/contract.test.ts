/**
 * The client declares the engine's API shapes locally so the app never bundles
 * the server (`src/lib/engineTypes.ts`). This test is what stops that copy from
 * drifting: it asserts, at compile time and at run time, that the engine's own
 * results still satisfy the client's view of them.
 */

import { MechanicsConfig, mechanicsSeedRows } from '@smoke/shared';
import { REQUEST_KINDS } from '@smoke/engine';
import type { PreviewResult as EnginePreview, SendResult as EngineSend } from '@smoke/engine';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  EngineRequestKind,
  PreviewResult as ClientPreview,
  SendResult as ClientSend,
} from '../src/lib/engineTypes';

describe('the engine contract', () => {
  it('gives the client exactly the preview it expects', () => {
    expectTypeOf<EnginePreview>().toMatchTypeOf<ClientPreview>();
  });

  it('gives the client exactly the send result it expects', () => {
    expectTypeOf<EngineSend>().toMatchTypeOf<ClientSend>();
  });

  it('agrees on the request kinds', () => {
    const kinds: EngineRequestKind[] = [...REQUEST_KINDS];
    expect(kinds.sort()).toEqual(['preview', 'resend', 'send']);
  });

  it('agrees on the character cap the counter enforces', () => {
    const config = MechanicsConfig.fromRows(mechanicsSeedRows());
    expect(config.get('message.char_cap')).toBe(280);
  });
});
