import { supabase } from '../config/supabaseClient.js';
export async function checkCache(key, fetchFn) {
  const now = new Date().toISOString();
  const { data: cache } = await supabase.from('cache').select('*').eq('key', key).lte('expires_at', now).single();
  if (cache) return cache.value;
  const data = await fetchFn();
  await supabase.from('cache').upsert({ key, value: data, expires_at: new Date(Date.now() + 3600000).toISOString() });
  return data;
}