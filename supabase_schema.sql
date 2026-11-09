-- =============================================================================
-- PulseTrack Supabase Schema Initialization
-- Run this in your Supabase SQL Editor (100% Free Tier)
-- =============================================================================

-- 1. Create incidents_public Table
CREATE TABLE IF NOT EXISTS public.incidents_public (
    id TEXT PRIMARY KEY,
    "victimName" TEXT,
    status TEXT NOT NULL DEFAULT 'TRAPPED',
    "triggerReason" TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    battery INTEGER,
    "packetType" TEXT,
    timestamp BIGINT,
    "audioDB" TEXT,
    "motionMS2" TEXT,
    "rescuerId" TEXT
);

-- 2. Create incidents_private Table
CREATE TABLE IF NOT EXISTS public.incidents_private (
    id TEXT PRIMARY KEY REFERENCES public.incidents_public(id) ON DELETE CASCADE,
    "photoUrl" TEXT,
    "audioUrl" TEXT,
    transcript TEXT,
    "aiTriage" TEXT DEFAULT 'Pending...',
    "priorityLevel" INTEGER
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.incidents_public ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents_private ENABLE ROW LEVEL SECURITY;

-- Permissive policies for PulseTrack operations (public emergency mesh)
CREATE POLICY "Allow public read on incidents_public"
    ON public.incidents_public FOR SELECT USING (true);

CREATE POLICY "Allow public insert on incidents_public"
    ON public.incidents_public FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on incidents_public"
    ON public.incidents_public FOR UPDATE USING (true);

CREATE POLICY "Allow public read on incidents_private"
    ON public.incidents_private FOR SELECT USING (true);

CREATE POLICY "Allow public insert on incidents_private"
    ON public.incidents_private FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update on incidents_private"
    ON public.incidents_private FOR UPDATE USING (true);

-- 4. Enable Supabase Realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents_public;
ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents_private;

-- 5. Create Storage Bucket for Incident Media
INSERT INTO storage.buckets (id, name, public)
VALUES ('incident-media', 'incident-media', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for incident-media bucket
CREATE POLICY "Allow public read on incident-media"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'incident-media');

CREATE POLICY "Allow public upload to incident-media"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'incident-media');

CREATE POLICY "Allow public update to incident-media"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'incident-media');
