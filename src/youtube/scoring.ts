import { Song } from '../types.js'

const OFFICIAL_CHANNEL_KEYWORDS = ['official', 'topic', 'vevo', 'records', 'music', 'audio']

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isoDurationToSeconds(value = ''): number {
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)

  if (!match) {
    return Infinity
  }

  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
}

function titleScore(title: string, query: string, channelTitle?: string): number {
  const normalizedTitle = normalize(title)
  const normalizedQuery = normalize(query)

  if (!normalizedTitle || !normalizedQuery) {
    return 0
  }

  if (normalizedTitle === normalizedQuery) {
    return 1500
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 1000
  }

  const queryWords = normalizedQuery.split(' ')
  const titleWords = new Set(normalizedTitle.split(' '))
  const meaningfulWords = queryWords.filter((word) => word.length >= 2)
  const matchedWords = meaningfulWords.filter((word) => titleWords.has(word)).length
  let score = matchedWords * 180

  for (const word of meaningfulWords) {
    if (normalizedTitle.includes(word)) {
      score += 40
    }
  }

  if (meaningfulWords.length > 1 && matchedWords === meaningfulWords.length) {
    score += 300
  }

  if (channelTitle) {
    const normalizedChannel = normalize(channelTitle)

    if (OFFICIAL_CHANNEL_KEYWORDS.some((keyword) => normalizedChannel.includes(keyword))) {
      score += 50
    }
  }

  return score
}

function popularityScore(views: number): number {
  return Math.log10(views + 1) * 50
}

function durationScore(duration: number): number {
  if (duration >= 150 && duration <= 420) {
    return 100
  }

  if (duration < 150) {
    return Math.max(0, 100 - (150 - duration) * 0.5)
  }

  return Math.max(0, 100 - (duration - 420) * 0.5)
}

export function combinedScore(song: Song, query: string): number {
  return titleScore(song.title, query, song.channelTitle) + popularityScore(song.views) + durationScore(song.duration)
}

export function formatViews(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`
  return views.toString()
}
