export interface FeedArticle {
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedAt: string;
}

export interface FeedResponse {
  items: FeedArticle[];
}
