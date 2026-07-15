# 🚀 Funnelcraft: Turn Your Content into a Lead Funnel

**Funnelcraft** is a modern, premium full-stack SaaS platform designed for creators, developers, and founders to convert their online profile and expertise into an SEO-optimized inbound lead generation funnel. 

By analyzing user resumes, website pages, and competitor search rankings, Funnelcraft designs custom outranking content pillars and auto-generates long-form blog drafts and social media copywriting campaigns matched perfectly to the user's voice.

---

## 🏗️ System Architecture

Funnelcraft is engineered with a decoupled, event-driven background processing architecture to handle long-running AI copywriting and web scraping tasks asynchronously.

```mermaid
graph TD
    User([User Browser]) -->|Vite / Tailwind| Frontend[React Single Page Application]
    Frontend -->|REST APIs / JWT| Express[Express.js API Gateway]
    
    %% Storage & Queue Layers
    Express -->|SQL Query / RAG| Supabase[(Supabase PostgreSQL + pgvector)]
    Express -->|Job Dispatch| Redis[(Upstash Serverless Redis)]
    
    %% Background Workers
    Worker[BullMQ Background Worker] -->|Listen / Pull| Redis
    Worker -->|Vector Query / Embeddings| Supabase
    Worker -->|Scrape / Index| Serper[Serper.dev Google Crawl API]
    Worker -->|AI Generation| LLM[LLM Engine: Gemini / Groq / OpenRouter]
    Worker -->|Download / Re-host| Storage[Supabase Storage / Local Fallback]
```

---

## ⚡ Key Engineering Achievements

*   **Bring Your Own Key (BYOK) Architecture**: Implemented a fully swappable, encrypted AI provider connection supporting **Google Gemini API**, **Groq**, and **OpenRouter** with automatic rate-limit (429) backoffs and deprecation sleep retries.
*   **Asynchronous Job Processing Queue**: Designed an event-driven task pipeline using **BullMQ** and **Redis** to execute long-running SEO gap analysis and image generation tasks in the background, preventing HTTP timeouts.
*   **Resume & Website RAG (Retrieval-Augmented Generation)**: Integrated **pgvector** on PostgreSQL to create semantic embeddings of uploaded resumes and crawled website contents, providing contextual voice alignment in generated drafts.
*   **Competitor Gap Analyzer**: Leveraged Google Serper API search queries to crawl organic search rankings, extracting content structures from competitor sites to output outranking title proposals.
*   **Conceptual Photography Pipeline**: Created a re-hosting image service that fetches conceptual photography from Pollinations.ai, checks access, and automatically uploads it to **Supabase Storage** (falling back to local disk storage if cloud buckets are not configured).
*   **Frosted Glassmorphism UI**: Built a premium design system featuring a global **Light/Dark theme toggle**, fluid layout scaling, and robust absolute-centered success toasts.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React (Vite), TailwindCSS, Lucide Icons, HTML5 |
| **Backend** | Node.js, Express.js, BullMQ, Axios |
| **Database & Auth** | PostgreSQL (with `pgvector`) & JWT Auth hosted on Supabase |
| **Queue / Cache** | Redis (Upstash Redis in production) |
| **Integrations** | Google Gemini SDK, Groq Cloud, OpenRouter API, Serper API, Pollinations.ai |

---

## 💻 Local Setup & Installation

### 1. Database Setup (Supabase)
Create a new Supabase project and execute the following SQL in the SQL Editor to set up the vector database and content schemas:
```sql
-- Enable vector extensions
create extension if not exists vector;

-- Create content table
create table public.published_content (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  platform text not null, -- 'blog', 'linkedin', 'twitter'
  title text not null,
  body text not null,
  image_urls text,
  embedding vector(1536),
  keywords text[],
  status text default 'draft', -- 'draft', 'marked_published'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  published_at timestamp with time zone
);
```

### 2. Configure Backend Credentials
Create a `.env` file in the `backend/` directory:
```env
PORT=5000
DATABASE_URL=postgresql://postgres.your-project-id:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
REDIS_URL=redis://127.0.0.1:6379
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
SERPER_API_KEY=your-serper-api-key
```

### 3. Run the Services
Open three separate terminals in your workspace directory:

*   **Terminal 1: Start the API Server**
    ```bash
    cd backend
    npm install
    npm run start:api
    ```
*   **Terminal 2: Start the Queue Worker**
    ```bash
    cd backend
    npm run start:worker
    ```
*   **Terminal 3: Start the React Frontend**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

---

## 🌐 Cloud Deployment

Detailed step-by-step instructions for deploying to cloud infrastructure can be found in the [Production Deployment Guide](file:///C:/Users/manie/.gemini/antigravity-ide/brain/63e6de9f-5a78-49a4-a21c-3a8367a45919/deployment_guide.md):
*   **Vite Frontend**: Deploy to **Vercel** with the `VITE_API_URL` environment variable pointing to the deployed backend.
*   **Express API Server**: Deploy to **Render** or **Railway** as a Web Service.
*   **Queue Worker**: Deploy to **Render** or **Railway** as a Background Worker linked to an [Upstash Redis](https://upstash.com/) instance.
