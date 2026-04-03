-- CineContent — schéma Supabase (idempotent, aligné sur schema_full.sql).
-- npm run db:migrate ou SQL Editor Supabase.

-- ============================================================
-- CineContent — schéma Supabase (idempotent : réexécutable sans erreur)
-- ============================================================

-- ============================================================
-- 1. ENUMS
-- ============================================================

DO $enum$ BEGIN
  CREATE TYPE public.caption_style AS ENUM ('punchy', 'clean', 'suspense', 'quiz_challenge', 'movie_fans', 'beat_this');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;

DO $enum$ BEGIN
  CREATE TYPE public.clip_status AS ENUM ('rendering', 'rendered', 'ready_for_approval', 'approved', 'rejected', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;

DO $enum$ BEGIN
  CREATE TYPE public.log_category AS ENUM ('run', 'clip', 'caption', 'approval', 'publish', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;

DO $enum$ BEGIN
  CREATE TYPE public.log_level AS ENUM ('info', 'warn', 'error', 'success');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;

DO $enum$ BEGIN
  CREATE TYPE public.platform AS ENUM ('instagram', 'tiktok');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;

DO $enum$ BEGIN
  CREATE TYPE public.publish_status AS ENUM ('pending', 'publishing', 'published', 'failed', 'retry');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;

DO $enum$ BEGIN
  CREATE TYPE public.run_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;

DO $enum$ BEGIN
  CREATE TYPE public.strategy_status AS ENUM ('draft', 'active', 'paused', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $enum$;

-- ============================================================
-- 2. FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email));
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_strategies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  game text NOT NULL,
  game_url text NOT NULL DEFAULT '',
  theme text NOT NULL DEFAULT '',
  bot_goal text NOT NULL DEFAULT '',
  content_angle text NOT NULL DEFAULT '',
  hook_template text NOT NULL DEFAULT '',
  platforms platform[] NOT NULL DEFAULT '{tiktok}',
  target_clip_duration integer NOT NULL DEFAULT 20,
  caption_style caption_style NOT NULL DEFAULT 'punchy',
  runs_to_launch integer NOT NULL DEFAULT 3,
  status strategy_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  strategy_id uuid NOT NULL REFERENCES public.content_strategies(id),
  game text NOT NULL,
  theme text NOT NULL DEFAULT '',
  bot_goal text NOT NULL DEFAULT '',
  score integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  duration integer NOT NULL DEFAULT 0,
  viral_score integer NOT NULL DEFAULT 0,
  status run_status NOT NULL DEFAULT 'pending',
  summary text NOT NULL DEFAULT '',
  raw_video_url text,
  replay_url text,
  bot_callback_token text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.run_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.runs(id),
  event_type text NOT NULL,
  description text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}',
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clips (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.runs(id),
  strategy_id uuid NOT NULL REFERENCES public.content_strategies(id),
  game text NOT NULL,
  platform platform NOT NULL DEFAULT 'tiktok',
  version integer NOT NULL DEFAULT 1,
  duration integer NOT NULL DEFAULT 0,
  status clip_status NOT NULL DEFAULT 'rendering',
  caption text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}',
  first_comment text NOT NULL DEFAULT '',
  video_url text,
  thumbnail_url text,
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.publish_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  clip_id uuid NOT NULL REFERENCES public.clips(id),
  platform platform NOT NULL,
  status publish_status NOT NULL DEFAULT 'pending',
  external_post_id text,
  error_message text,
  published_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.published_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  publish_job_id uuid NOT NULL REFERENCES public.publish_jobs(id),
  clip_id uuid NOT NULL REFERENCES public.clips(id),
  platform platform NOT NULL,
  external_post_id text NOT NULL DEFAULT '',
  strategy_name text NOT NULL DEFAULT '',
  game text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  views integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  name text NOT NULL,
  connected boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}',
  last_sync timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  key text NOT NULL,
  value text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  level log_level NOT NULL DEFAULT 'info',
  category log_category NOT NULL DEFAULT 'system',
  message text NOT NULL,
  details text,
  entity_id uuid,
  entity_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_content_strategies_updated_at ON public.content_strategies;
CREATE TRIGGER update_content_strategies_updated_at BEFORE UPDATE ON public.content_strategies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_runs_updated_at ON public.runs;
CREATE TRIGGER update_runs_updated_at BEFORE UPDATE ON public.runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_clips_updated_at ON public.clips;
CREATE TRIGGER update_clips_updated_at BEFORE UPDATE ON public.clips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_publish_jobs_updated_at ON public.publish_jobs;
CREATE TRIGGER update_publish_jobs_updated_at BEFORE UPDATE ON public.publish_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_published_posts_updated_at ON public.published_posts;
CREATE TRIGGER update_published_posts_updated_at BEFORE UPDATE ON public.published_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_integrations_updated_at ON public.integrations;
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

ALTER TABLE public.content_strategies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own strategies" ON public.content_strategies;
CREATE POLICY "Users can view own strategies" ON public.content_strategies FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own strategies" ON public.content_strategies;
CREATE POLICY "Users can create own strategies" ON public.content_strategies FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own strategies" ON public.content_strategies;
CREATE POLICY "Users can update own strategies" ON public.content_strategies FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own strategies" ON public.content_strategies;
CREATE POLICY "Users can delete own strategies" ON public.content_strategies FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own runs" ON public.runs;
CREATE POLICY "Users can view own runs" ON public.runs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own runs" ON public.runs;
CREATE POLICY "Users can create own runs" ON public.runs FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own runs" ON public.runs;
CREATE POLICY "Users can update own runs" ON public.runs FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own runs" ON public.runs;
CREATE POLICY "Users can delete own runs" ON public.runs FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.run_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view events of own runs" ON public.run_events;
CREATE POLICY "Users can view events of own runs" ON public.run_events FOR SELECT USING (EXISTS (SELECT 1 FROM public.runs WHERE public.runs.id = run_events.run_id AND public.runs.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can insert events for own runs" ON public.run_events;
CREATE POLICY "Users can insert events for own runs" ON public.run_events FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.runs WHERE public.runs.id = run_events.run_id AND public.runs.user_id = auth.uid()));

ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own clips" ON public.clips;
CREATE POLICY "Users can view own clips" ON public.clips FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own clips" ON public.clips;
CREATE POLICY "Users can create own clips" ON public.clips FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own clips" ON public.clips;
CREATE POLICY "Users can update own clips" ON public.clips FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own clips" ON public.clips;
CREATE POLICY "Users can delete own clips" ON public.clips FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own publish jobs" ON public.publish_jobs;
CREATE POLICY "Users can view own publish jobs" ON public.publish_jobs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own publish jobs" ON public.publish_jobs;
CREATE POLICY "Users can create own publish jobs" ON public.publish_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own publish jobs" ON public.publish_jobs;
CREATE POLICY "Users can update own publish jobs" ON public.publish_jobs FOR UPDATE USING (auth.uid() = user_id);

ALTER TABLE public.published_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own posts" ON public.published_posts;
CREATE POLICY "Users can view own posts" ON public.published_posts FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own posts" ON public.published_posts;
CREATE POLICY "Users can create own posts" ON public.published_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own posts" ON public.published_posts;
CREATE POLICY "Users can update own posts" ON public.published_posts FOR UPDATE USING (auth.uid() = user_id);

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own integrations" ON public.integrations;
CREATE POLICY "Users can view own integrations" ON public.integrations FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own integrations" ON public.integrations;
CREATE POLICY "Users can create own integrations" ON public.integrations FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own integrations" ON public.integrations;
CREATE POLICY "Users can update own integrations" ON public.integrations FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own integrations" ON public.integrations;
CREATE POLICY "Users can delete own integrations" ON public.integrations FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own settings" ON public.app_settings;
CREATE POLICY "Users can view own settings" ON public.app_settings FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create own settings" ON public.app_settings;
CREATE POLICY "Users can create own settings" ON public.app_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own settings" ON public.app_settings;
CREATE POLICY "Users can update own settings" ON public.app_settings FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own settings" ON public.app_settings;
CREATE POLICY "Users can delete own settings" ON public.app_settings FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own logs" ON public.activity_logs;
CREATE POLICY "Users can view own logs" ON public.activity_logs FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own logs" ON public.activity_logs;
CREATE POLICY "Users can insert own logs" ON public.activity_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 6. STORAGE BUCKET
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('gameplay-videos', 'gameplay-videos', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public;

DROP POLICY IF EXISTS "Public read gameplay videos" ON storage.objects;
CREATE POLICY "Public read gameplay videos" ON storage.objects FOR SELECT USING (bucket_id = 'gameplay-videos');

DROP POLICY IF EXISTS "Authenticated users can upload gameplay videos" ON storage.objects;
CREATE POLICY "Authenticated users can upload gameplay videos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'gameplay-videos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can update own gameplay videos" ON storage.objects;
CREATE POLICY "Users can update own gameplay videos" ON storage.objects FOR UPDATE USING (bucket_id = 'gameplay-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can delete own gameplay videos" ON storage.objects;
CREATE POLICY "Users can delete own gameplay videos" ON storage.objects FOR DELETE USING (bucket_id = 'gameplay-videos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- 7. REALTIME
-- ============================================================

DO $pub$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;
  END IF;
END $pub$;

DO $pub$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'clips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clips;
  END IF;
END $pub$;
