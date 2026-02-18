import { XMLParser } from "fast-xml-parser";

export type RSSFeed = {
  channel: {
    title: string;
    link: string;
    description: string;
    item: RSSItem[];
  };
};

export type RSSItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
};

export async function fetchFeed(feedURL: string): Promise<RSSFeed> {
  const response = await fetch(feedURL, {
    headers: {
      "User-Agent": "gator",
    },
  });

  const xmlString = await response.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xmlString);

  if (!parsed.rss || !parsed.rss.channel) {
    throw new Error("Invalid RSS feed: missing channel field");
  }

  const channel = parsed.rss.channel;

  let items: RSSItem[] = [];
  if (channel.item) {
    items = Array.isArray(channel.item) ? channel.item : [channel.item];
  }

  return {
    channel: {
      title: channel.title,
      link: channel.link,
      description: channel.description,
      item: items,
    },
  };
}