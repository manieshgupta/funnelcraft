const { Queue } = require('bullmq');
const db = require('./db');
const IORedis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let queue = null;
let redisClient = null;
let useRedis = true;

try {
  console.log(`[Queue] Attempting Redis connection at: ${REDIS_URL}`);
  redisClient = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 2000,
    retryStrategy: (times) => {
      if (times > 3) {
        if (useRedis) {
          console.warn('[Queue] Redis connection timed out. Falling back to in-process direct execution mode.');
          useRedis = false;
        }
        return null; // stop reconnecting
      }
      return Math.min(times * 100, 1000);
    }
  });

  redisClient.on('error', (err) => {
    if (useRedis && err.code !== 'ECONNREFUSED') {
      console.warn('[Queue] Redis connection error:', err.message);
    }
  });

  queue = new Queue('agent-jobs', {
    connection: redisClient,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    }
  });

  // Silence unhandled queue error events to prevent Node from printing stack traces
  queue.on('error', (err) => {});
} catch (e) {
  console.warn('[Queue] Redis failed to initialize. Falling back to direct-execution mode.');
  useRedis = false;
}

// Keep a registry reference to the worker processor for local direct-execution fallback
let directProcessor = null;

/**
 * Registers a worker function to be used during direct-execution fallback.
 * @param {Function} processor - The worker function
 */
function registerDirectProcessor(processor) {
  directProcessor = processor;
}

/**
 * Creates a job record in Postgres and schedules it for execution.
 * 
 * @param {string} userId - User UUID
 * @param {string} jobType - 'onboarding_research' | 'blog_titles' | 'blog_draft' | 'linkedin_draft' | 'twitter_draft'
 * @param {Object} payload - Input parameters for the job
 * @returns {Promise<string>} - The Postgres job UUID
 */
async function enqueueJob(userId, jobType, payload) {
  // 1. Insert a record into PostgreSQL jobs table
  const queryText = `
    INSERT INTO public.jobs (user_id, job_type, payload, status)
    VALUES ($1, $2, $3, 'queued')
    RETURNING id
  `;
  const dbResult = await db.query(queryText, [userId, jobType, JSON.stringify(payload)]);
  const jobId = dbResult.rows[0].id;

  // 2. Schedule the job
  if (useRedis && queue) {
    try {
      await queue.add(
        jobType,
        { jobId, userId, payload },
        { jobId: jobId } // Deduplicate BullMQ by DB jobId
      );
      console.log(`[Queue] Enqueued job ${jobId} (${jobType}) in BullMQ.`);
    } catch (err) {
      console.warn(`[Queue] BullMQ failed: ${err.message}. Triggering direct execution fallback.`);
      triggerDirectExecution(jobId, jobType, userId, payload);
    }
  } else {
    console.log(`[Queue] Direct Execution (No Redis): Scheduling job ${jobId} (${jobType}) in-process.`);
    triggerDirectExecution(jobId, jobType, userId, payload);
  }

  return jobId;
}

/**
 * Executes a job in-process via setTimeout (Local Dev Fallback)
 */
function triggerDirectExecution(jobId, jobType, userId, payload) {
  setTimeout(async () => {
    if (!directProcessor) {
      try {
        console.log('[Queue] Dynamically loading worker logic for in-process execution...');
        require('./worker');
      } catch (e) {
        console.error('[Queue] Failed to dynamically load worker logic:', e.message);
      }
    }

    if (!directProcessor) {
      console.error(`[Queue] Direct processor not registered! Job ${jobId} failed to run.`);
      await db.query(
        `UPDATE public.jobs SET status = 'failed', error = 'Direct processor not registered', finished_at = NOW() WHERE id = $1`,
        [jobId]
      );
      return;
    }

    try {
      // Transition database state to running
      await db.query(`UPDATE public.jobs SET status = 'running' WHERE id = $1`, [jobId]);
      
      // Simulate BullMQ job format for the processor
      const mockJob = {
        id: jobId,
        name: jobType,
        data: { jobId, userId, payload }
      };

      await directProcessor(mockJob);
      console.log(`[Queue] Direct execution completed for job ${jobId}.`);
    } catch (err) {
      console.error(`[Queue] Direct execution crashed for job ${jobId}:`, err);
      await db.query(
        `UPDATE public.jobs SET status = 'failed', error = $1, finished_at = NOW() WHERE id = $2`,
        [err.message, jobId]
      );
    }
  }, 100);
}

module.exports = {
  enqueueJob,
  registerDirectProcessor,
  redisClient,
  queue
};
