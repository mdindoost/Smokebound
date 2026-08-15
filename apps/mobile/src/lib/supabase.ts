/**
 * The Supabase client, and the app's single composition point.
 *
 * The transport choice lives here: `table` by default, because that is the
 * launch configuration (ARCHITECTURE §6.4) — the engine runs behind NAT and the
 * client reaches it through the database.
 */

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { SupabaseGateway } from './supabaseGateway';
import { HttpTransport, TableTransport } from './transport';
import type { EngineTransport } from './transport';

/** Sessions live in the keychain, not in AsyncStorage. */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill in your Supabase project.`,
    );
  }
  return value;
}

let client: SupabaseClient | null = null;

export function supabaseClient(): SupabaseClient {
  if (client) return client;

  client = createClient(
    required('EXPO_PUBLIC_SUPABASE_URL', process.env['EXPO_PUBLIC_SUPABASE_URL']),
    required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY']),
    {
      auth: {
        storage: secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    },
  );
  return client;
}

export function engineTransport(supabase: SupabaseClient): EngineTransport {
  const mode = process.env['EXPO_PUBLIC_ENGINE_TRANSPORT'] ?? 'table';
  const baseUrl = process.env['EXPO_PUBLIC_ENGINE_URL'];

  if (mode === 'http') {
    if (!baseUrl) throw new Error('EXPO_PUBLIC_ENGINE_URL is required for the http transport');
    return new HttpTransport({
      baseUrl,
      accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    });
  }
  return new TableTransport(supabase);
}

export function createGateway(): SupabaseGateway {
  const supabase = supabaseClient();
  return new SupabaseGateway(supabase, engineTransport(supabase));
}
