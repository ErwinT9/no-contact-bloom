ALTER TABLE public.pictures
  DROP CONSTRAINT IF EXISTS pictures_storage_kind_check;

ALTER TABLE public.pictures
  ALTER COLUMN storage_kind SET DEFAULT 'local';

ALTER TABLE public.pictures
  ADD CONSTRAINT pictures_storage_kind_check
  CHECK (storage_kind IN ('local', 'drive')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.user_picture_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_location text NOT NULL DEFAULT 'local'
    CHECK (storage_location IN ('local', 'google_drive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_picture_prefs TO authenticated;
GRANT ALL ON public.user_picture_prefs TO service_role;

ALTER TABLE public.user_picture_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own picture prefs"
  ON public.user_picture_prefs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_user_picture_prefs_updated_at
  BEFORE UPDATE ON public.user_picture_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();