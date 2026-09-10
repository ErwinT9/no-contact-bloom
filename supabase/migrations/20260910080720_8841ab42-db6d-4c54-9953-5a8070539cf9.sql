CREATE TABLE public.daily_exercise_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  local_date date NOT NULL,
  session_id text NOT NULL,
  session_title text NOT NULL,
  completed_steps integer NOT NULL DEFAULT 0,
  total_steps integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, local_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_exercise_sessions TO authenticated;
GRANT ALL ON public.daily_exercise_sessions TO service_role;

ALTER TABLE public.daily_exercise_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own daily exercise sessions"
ON public.daily_exercise_sessions
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER daily_exercise_sessions_updated_at
BEFORE UPDATE ON public.daily_exercise_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();