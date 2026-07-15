-- Enable the pgvector extension to store and search embeddings
create extension if not exists vector;

-- Local dev compatibility schema for non-Supabase environments
create schema if not exists vault;

create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  name text,
  description text,
  created_at timestamp with time zone default now()
);

-- Mock view for decryption
create or replace view vault.decrypted_secrets as
select id, secret as decrypted_secret, name, description, created_at
from vault.secrets;

-- Mock function for secret creation
create or replace function vault.create_secret(
  secret_val text,
  secret_name text,
  secret_desc text default ''
) returns uuid as $$
declare
  new_id uuid;
begin
  insert into vault.secrets (secret, name, description)
  values (secret_val, secret_name, secret_desc)
  returning id into new_id;
  return new_id;
end;
$$ language plpgsql;

-- Local dev compatibility schema for auth
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Create users table (extends Supabase Auth auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  account_type text check (account_type in ('company', 'personal')) not null,
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security (RLS)
alter table public.users enable row level security;
create policy "Users can read their own profile" on public.users for select using (auth.uid() = id);
create policy "Users can update their own profile" on public.users for update using (auth.uid() = id);

-- Create user_ai_credentials
create table public.user_ai_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  provider text check (provider in ('openrouter', 'groq', 'gemini')) not null,
  vault_secret_id uuid references vault.secrets(id) on delete cascade not null,
  is_valid boolean default true,
  last_validated_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  unique(user_id, provider)
);

alter table public.user_ai_credentials enable row level security;
create policy "Users can view their own credentials metadata" on public.user_ai_credentials for select using (auth.uid() = user_id);

-- Create user_model_preferences
create table public.user_model_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  task_type text check (task_type in ('planning', 'draft', 'linkedin', 'twitter')) not null,
  model_slug text not null,
  updated_at timestamp with time zone default now(),
  unique(user_id, task_type)
);

alter table public.user_model_preferences enable row level security;
create policy "Users can manage their own model preferences" on public.user_model_preferences for all using (auth.uid() = user_id);

-- Create company_profile
create table public.company_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade unique not null,
  company_name text not null,
  website_url text,
  linkedin_url text,
  summary text,
  industry text,
  icp_description text,
  services jsonb default '[]'::jsonb, -- Array of {name, description}
  brand_tone text,
  onboarding_status text check (onboarding_status in ('pending', 'processing', 'complete', 'failed')) default 'pending',
  created_at timestamp with time zone default now()
);

alter table public.company_profile enable row level security;
create policy "Users can manage their own company profile" on public.company_profile for all using (auth.uid() = user_id);

-- Create personal_profile
create table public.personal_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade unique not null,
  full_name text not null,
  job_role text,
  resume_url text, -- Supabase Storage file path
  linkedin_url text,
  twitter_url text,
  portfolio_url text,
  target_audience text,
  content_goal text,
  summary text, -- LLM-extracted profile angle
  content_pillars jsonb default '[]'::jsonb,
  onboarding_status text check (onboarding_status in ('pending', 'processing', 'complete', 'failed')) default 'pending',
  created_at timestamp with time zone default now()
);

alter table public.personal_profile enable row level security;
create policy "Users can manage their own personal profile" on public.personal_profile for all using (auth.uid() = user_id);

-- Create knowledge_chunks for RAG
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  source text check (source in ('website', 'linkedin', 'resume', 'portfolio')) not null,
  content text not null,
  embedding vector(1536),
  created_at timestamp with time zone default now()
);

alter table public.knowledge_chunks enable row level security;
create policy "Users can manage their own knowledge chunks" on public.knowledge_chunks for all using (auth.uid() = user_id);

-- Create competitor_content_seen for gap analysis and deduplication
create table public.competitor_content_seen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  platform text not null, -- 'blog' | 'linkedin' | 'twitter'
  url text,
  title text,
  summary text,
  embedding vector(1536),
  scraped_at timestamp with time zone default now()
);

alter table public.competitor_content_seen enable row level security;
create policy "Users can manage their own competitor content records" on public.competitor_content_seen for all using (auth.uid() = user_id);

-- Create published_content
create table public.published_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  platform text check (platform in ('blog', 'linkedin', 'twitter')) not null,
  title text,
  body text not null,
  image_urls jsonb default '[]'::jsonb,
  embedding vector(1536),
  status text check (status in ('draft', 'marked_published', 'discarded')) default 'draft',
  keywords jsonb default '[]'::jsonb,
  created_at timestamp with time zone default now(),
  published_at timestamp with time zone
);

alter table public.published_content enable row level security;
create policy "Users can manage their own published content" on public.published_content for all using (auth.uid() = user_id);

-- Create blog_title_suggestions
create table public.blog_title_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  input_topic text,
  suggestions jsonb default '[]'::jsonb, -- Array of {title, rank, rationale, target_keywords}
  created_at timestamp with time zone default now()
);

alter table public.blog_title_suggestions enable row level security;
create policy "Users can manage their own blog title suggestions" on public.blog_title_suggestions for all using (auth.uid() = user_id);

-- Create jobs tracking table
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade not null,
  job_type text check (job_type in ('onboarding_research', 'blog_titles', 'blog_draft', 'linkedin_draft', 'twitter_draft')) not null,
  status text check (status in ('queued', 'running', 'complete', 'failed')) default 'queued',
  payload jsonb default '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamp with time zone default now(),
  finished_at timestamp with time zone
);

alter table public.jobs enable row level security;
create policy "Users can view their own jobs" on public.jobs for select using (auth.uid() = user_id);

-- Create HNSW indexes on embeddings for high-speed similarity search
create index on public.knowledge_chunks using hnsw (embedding vector_cosine_ops);
create index on public.competitor_content_seen using hnsw (embedding vector_cosine_ops);
create index on public.published_content using hnsw (embedding vector_cosine_ops);
