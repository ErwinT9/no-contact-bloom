export type Profile = {
  id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  recovery_started_at: string;
  notifications_enabled: boolean;
  notification_prefs: Record<string, boolean>;
  push_token: string | null;
  questionnaire_completed: boolean;
  is_premium: boolean;
};

export type Streak = {
  id: string;
  user_id: string;
  started_at: string;
  best_days: number;
  relapse_count: number;
  ex_name: string | null;
};

export type QuestionnaireAnswers = {
  id: string;
  user_id: string;
  nickname: string | null;
  age_range: string | null;
  gender: string | null;
  relationship_length: string | null;
  who_ended: string | null;
  last_contact_at: string | null;
  reasons: string[];
  checks_social: string | null;
  difficulty_today: number | null;
  biggest_goal: string | null;
  wants_reminders: boolean | null;
  referral_source: string | null;
  completed: boolean;
};

export type Flag = {
  id: string;
  user_id: string;
  title: string;
  category: string;
  note: string | null;
  created_at: string;
};

export type Win = {
  id: string;
  user_id: string;
  title: string;
  note: string | null;
  achieved_on: string;
  created_at: string;
};

export type BadgeRow = {
  id: string;
  user_id: string;
  badge_key: string;
  unlocked_at: string;
};

export type Letter = {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  emotion: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
};

export type DailyPromise = {
  id: string;
  user_id: string;
  promised_on: string;
  created_at: string;
};

export type Picture = {
  id: string;
  user_id: string;
  /** Legacy Supabase Storage path; empty for Drive-backed pictures. */
  image_url: string;
  caption: string | null;
  taken_on: string;
  created_at: string;
  /** Where the image file lives. New pictures are always "drive". */
  storage_kind: "supabase" | "drive";
  drive_file_id: string | null;
  drive_web_link: string | null;
};

export type Affirmation = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type Ritual = {
  id: string;
  user_id: string;
  title: string;
  note: string | null;
  created_at: string;
};

export type Trigger = {
  id: string;
  user_id: string;
  title: string;
  note: string | null;
  created_at: string;
};

export type JournalEntry = {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  mood: string | null;
  created_at: string;
};

export type MoodCheckin = {
  id: string;
  user_id: string;
  checkin_on: string;
  mood: string;
  action: string | null;
  custom_intention: string | null;
  completed_at: string;
  created_at: string;
};

export type WorryEntry = {
  id: string;
  user_id: string;
  worry_text: string;
  created_at: string;
};

export type GratitudeItemType = "candy" | "heart" | "leaf";

export type GratitudeEntry = {
  id: string;
  user_id: string;
  gratitude_text: string;
  item_type: GratitudeItemType;
  created_at: string;
};

export type JourneyProgress = {
  id: string;
  user_id: string;
  level_id: string;
  activity_id: string;
  status: string;
  completed: boolean;
  completed_at: string | null;
  /** Unique local calendar dates (YYYY-MM-DD) on which the practice was done. */
  day_dates: string[];
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type JourneyLevel = {
  id: string;
  user_id: string;
  level_id: string;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
