function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? value : fallback
}

export const config = {
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',
  port: numberEnv('PORT', 3000),
  minViews: numberEnv('MIN_VIEWS', 10_000),
  maxDurationSeconds: numberEnv('MAX_DURATION_SECONDS', 480),
  maxQueueSize: numberEnv('MAX_QUEUE_SIZE', 20),
  maxRequestsPerUser: numberEnv('MAX_REQUESTS_PER_USER', 2),
  searchResults: Math.min(50, Math.max(1, numberEnv('SEARCH_RESULTS', 10))),
  searchCacheTtlSeconds: numberEnv('SEARCH_CACHE_TTL_SECONDS', 3600),
  maxSearchesPerDay: numberEnv('MAX_SEARCHES_PER_DAY', 80)
}
