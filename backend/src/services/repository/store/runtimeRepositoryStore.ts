import { env } from "../../../config/env.js";
import { supabase } from "../../../lib/supabase.js";
import { MemoryRepositoryStore } from "./memoryRepositoryStore.js";
import { SupabaseRepositoryStore } from "./supabaseRepositoryStore.js";

export const repositoryStore = env.NODE_ENV === "test"
  ? new MemoryRepositoryStore()
  : new SupabaseRepositoryStore(supabase);
