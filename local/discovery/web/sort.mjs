// Shared by the importer and browser. Observation time is not a posting date.
export function postingTime(job) {
  if (job.postedAt) return Date.parse(job.postedAt) || 0;
  return Math.max(0, ...(job.posted_dates || []).map(value => Date.parse(value) || 0));
}
