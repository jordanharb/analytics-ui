export const PIPELINE_STEPS = [
  'twitter_scrape',
  'instagram_scrape',
  'post_process',
  'image_download',
  'event_process',
  'event_dedup',
  'coordinate_backfill'
] as const;

export type PipelineStep = typeof PIPELINE_STEPS[number];

export const STEP_LABELS: Record<PipelineStep, string> = {
  twitter_scrape: 'Twitter Scrape',
  instagram_scrape: 'Instagram Scrape',
  post_process: 'Post Processor',
  image_download: 'Image Downloader',
  event_process: 'Event Extraction',
  event_dedup: 'Event Deduplication',
  coordinate_backfill: 'Coordinate Backfill'
};

export const DEFAULT_RUN_INTERVAL_HOURS = 48;
