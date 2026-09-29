/**
 * SmartNav360 — Background jobs
 * Slow server work (panorama analysis, upscaling, tiles) answers 202 with a
 * job ID; this polls the job until it finishes.
 */

import apiClient from './api';
import { API_ENDPOINTS } from '../constants/api';

const POLL_MS = 1000;

const JobsService = {
  /** @returns {Promise<object>} { success, data: { id, status, progress, detail, result, error } } */
  async get(jobId) {
    const response = await apiClient.get(API_ENDPOINTS.JOB(jobId));
    return response.data;
  },

  /**
   * Resolves with the job's result once it is done, or rejects with its error.
   * @param {string} jobId
   * @param {{ onProgress?: (job: object) => void, signal?: AbortSignal, intervalMs?: number }} [options]
   */
  async waitFor(jobId, { onProgress, signal, intervalMs = POLL_MS } = {}) {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Stopped waiting for the job.', 'AbortError');
      const { data: job } = await JobsService.get(jobId);
      onProgress?.(job);
      if (job.status === 'done') return job.result;
      if (job.status === 'failed') {
        const error = new Error(job.error?.message || 'The job failed.');
        error.status = job.error?.status;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  },

  /** Runs a request that starts a job (answers { data: { jobId } }) and waits for its result. */
  async run(startRequest, options) {
    const reply = await startRequest();
    return JobsService.waitFor(reply.data.jobId, options);
  },

  /** @returns {Promise<object>} { success, data: [{ id, label, cached, device, usesGpu, licence }] } */
  async models() {
    const response = await apiClient.get(API_ENDPOINTS.SYSTEM_MODELS);
    return response.data;
  },
};

export default JobsService;
